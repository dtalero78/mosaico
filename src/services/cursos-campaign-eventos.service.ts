import 'server-only';
import { query, transaction } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { parseHorario, fechasEntre } from '@/lib/cursos-campaign';
import { esFestivoChile } from '@/lib/festivos-chile';
import { fechasFestivasPersonalizadas } from './festivos-personalizados.service';
import { eventoCompartidoIdDeGrupo } from '@/lib/grupo-horario-server';
import { bookingConRegistroSql } from '@/lib/booking-registro';
import { mapearLeccionesSalon } from './repetir-clase.service';
import { esAprobadoSql } from '@/lib/estados';
import { TZ_OPERACION } from '@/lib/cursos-campaign';

/** iso + n días (UTC, sin desfase de zona horaria). */
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Generación de eventos de CALENDARIO a partir de un curso de campaña.
 *
 * Cada curso (campaña + tipo + salón + guía + horario + inicio/final + cupos) se
 * expande a N sesiones reales: por cada día de la semana del horario, una sesión
 * en cada fecha del intervalo [inicioCurso, finalCurso].
 *
 * Zona horaria: el `dia` se ancla a la hora de Chile (`America/Santiago`, donde
 * opera la academia) — el front lo renderiza en la hora LOCAL de cada cliente, así
 * un usuario en Chile/Colombia/España ve la hora que le corresponde, sin desfases.
 *
 * Tipo de evento: SESSION. (En la UI, el tipo CLUB se muestra como "TALLER".)
 */

const PLATAFORMA_TZ = TZ_OPERACION;
const MAX_EVENTOS_POR_CURSO = 2000;

export interface CursoParaEventos {
  _id: string;
  campaign: string;
  tipoCurso: string;
  salon?: string | null;
  guia?: string | null;
  horarioCurso: string;
  inicioCurso?: string | null;
  finalCurso?: string | null;
  numeroUsuarios?: number | null;
  linkZoom?: string | null;
  /**
   * Grupo de salón (hasta 3 cursos con el mismo guía y horario). Si viene, cada
   * evento recibe un `eventoCompartidoId` DERIVADO de (grupo + fecha/hora), así
   * que los eventos de los cursos hermanos quedan enlazados solos — y el enlace
   * se reconstruye en cada regeneración sin que haya nada que mantener.
   */
  grupoHorarioId?: string | null;
}

/** Elimina todos los eventos de CALENDARIO generados por un curso de campaña. */
export async function eliminarEventosCurso(cursoId: string): Promise<number> {
  const r = await query(`DELETE FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [cursoId]);
  return r.rowCount ?? 0;
}

/**
 * (Re)genera los eventos de un curso: borra los previos del curso e inserta los
 * nuevos según horario + intervalo de fechas. Idempotente (enlazado por
 * cursoCampaignId). Devuelve la cantidad de eventos creados.
 */
export async function generarEventosCurso(curso: CursoParaEventos): Promise<number> {
  const inicio = curso.inicioCurso ? String(curso.inicioCurso).slice(0, 10) : '';
  const fin = curso.finalCurso ? String(curso.finalCurso).slice(0, 10) : '';
  const parsed = parseHorario(curso.horarioCurso);

  // Siempre limpiamos los previos (regeneración en edición / upsert).
  await eliminarEventosCurso(curso._id);

  if (!parsed || !inicio || !fin) return 0;
  const base = fechasEntre(inicio, fin, parsed.dias);
  if (base.length === 0) return 0;

  // Fechas suspendidas a mano para este curso (Académico › Sesiones › Suspende
  // Sesión). Se tratan EXACTAMENTE igual que un festivo. Viven en tabla porque
  // regenerar un curso borra y recrea sus eventos: sin persistirlas, la fecha
  // suspendida reaparecería.
  const susp = await query<{ fecha: string }>(
    `SELECT "fecha"::text AS "fecha" FROM "CURSOS_SUSPENSIONES" WHERE "cursoCampaignId" = $1`,
    [curso._id]
  ).catch(() => ({ rows: [] as { fecha: string }[] })); // tabla aún no creada → sin suspensiones
  const suspendidas = new Set(susp.rows.map((r) => String(r.fecha).slice(0, 10)));

  // Festivos declarados por Académico (Académico › Sesiones › Festivos), que se
  // SUMAN a los del calendario de Chile: la semana de Fiestas Patrias, un puente,
  // un cierre. Son globales, a diferencia de las suspensiones, que son de un curso.
  const personalizados = await fechasFestivasPersonalizadas();

  /** No se dicta clase: festivo de Chile, festivo declarado o suspensión del curso. */
  const noHayClase = (d: string) =>
    esFestivoChile(d) || personalizados.has(d) || suspendidas.has(d);

  // Feriados de Chile y suspensiones: NO se agenda clase ese día; esa sesión se
  // corre al FINAL del curso (se mantiene el nº total de sesiones = nº de clases
  // del horario en el intervalo). Ej.: si un miércoles cae festivo, la última
  // sesión pasa al siguiente día-clase después de finalCurso.
  const objetivo = Math.min(base.length, MAX_EVENTOS_POR_CURSO);
  let fechas = base.filter((d) => !noHayClase(d));
  if (fechas.length < objetivo) {
    let cursor = fin;
    let guard = 0;
    while (fechas.length < objetivo && guard < 520) {
      for (const d of fechasEntre(addDaysISO(cursor, 1), addDaysISO(cursor, 7), parsed.dias)) {
        if (!noHayClase(d)) { fechas.push(d); if (fechas.length >= objetivo) break; }
      }
      cursor = addDaysISO(cursor, 7);
      guard++;
    }
  }
  if (fechas.length > objetivo) fechas = fechas.slice(0, objetivo);
  fechas.sort();

  const hora = parsed.hora.length === 4 ? `0${parsed.hora}` : parsed.hora; // "9:00"→"09:00"
  const salon = (curso.salon || '').trim();
  const titulo = [curso.campaign, curso.tipoCurso, salon].filter(Boolean).join(' - ');
  const advisor = (curso.guia || '').trim();
  const nivel = curso.tipoCurso;
  const limite = Number(curso.numeroUsuarios) || 0;
  // El link de la sesión es la sala Zoom de la GUÍA asignada (ella dicta la clase
  // en su sala). Si el curso trae un linkZoom explícito, ese manda; si no, se
  // resuelve el zoom de la guía. Sin guía / sin zoom → null (queda sin link).
  let linkZoom = curso.linkZoom || null;
  if (!linkZoom && advisor) {
    const gz = await query<{ zoom: string | null }>(
      `SELECT "zoom" FROM "GUIAS" WHERE "_id" = $1 LIMIT 1`, [advisor]
    ).catch(() => ({ rows: [] as { zoom: string | null }[] }));
    linkZoom = (gz.rows[0]?.zoom || '').trim() || null;
  }

  // INSERT multi-fila. Columnas parametrizadas por evento (15); el resto literales.
  const grupo = (curso.grupoHorarioId || '').trim() || null;
  const cols = '"_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","eventoCompartidoId","inscritos","origen","sesionCerrada","_createdDate","_updatedDate"';
  const params: any[] = [];
  const rows: string[] = [];
  fechas.forEach((fecha, r) => {
    const b = r * 15;
    rows.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},` +
      `($${b + 6}::timestamp AT TIME ZONE '${PLATAFORMA_TZ}'),` +
      `$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},` +
      `0,'POSTGRES',false,NOW(),NOW())`
    );
    params.push(
      ids.event(),      // _id
      'SESSION',        // tipo
      'SESSION',        // evento
      fecha,            // fecha
      hora,             // hora
      `${fecha} ${hora}:00`, // dia (timestamp local → AT TIME ZONE Chile)
      advisor,          // advisor (guía _id)
      nivel,            // nivel (tipoCurso)
      titulo,           // titulo (NOT NULL)
      titulo,           // tituloONivel = "Campaña - Curso - Salón"
      curso.horarioCurso, // nombreEvento = horario
      linkZoom,         // linkZoom
      limite,           // limiteUsuarios
      curso._id,        // cursoCampaignId
      // Enlace con los cursos hermanos del grupo: se DERIVA de (grupo + fecha/hora
      // local), no se guarda en ningún lado, así que sobrevive a las regeneraciones.
      grupo ? eventoCompartidoIdDeGrupo(grupo, `${fecha} ${hora}`) : null,
    );
  });

  await query(`INSERT INTO "CALENDARIO" (${cols}) VALUES ${rows.join(', ')}`, params);
  // Camino B: asigna a cada sesión su lección (secuencia del curso por fecha).
  try { await mapearLeccionesSalon(curso._id); } catch { /* best-effort */ }
  return fechas.length;
}

/** Campos de estado del booking que NO deben perderse al regenerar. */
const STATE_COLS = ['asistio', 'asistencia', 'participacion', 'noAprobo', 'cancelo', 'calificacion', 'comentarios'] as const;

export interface RegenResult {
  eventos: number;
  bookings: number;
  alumnos: number;
  estadoReaplicado: number;
  /** Estado cuya fecha ya no existe como evento (p.ej. la fecha quedó suspendida). */
  estadoSinMatch: number;
}

/**
 * Regenera los eventos de UN curso preservando la asistencia ya tomada.
 *
 * Regenerar = borrar y recrear desde (inicio, final, horario), descontando
 * festivos y suspensiones. Como eso destruiría la asistencia marcada, aquí se
 * snapshotea el estado por (estudiante, fecha) y se re-aplica al booking nuevo de
 * la misma fecha. Las fechas pasadas no cambian, así que el estado vuelve a su
 * sitio; si una fecha con estado quedó suspendida, se reporta en `estadoSinMatch`.
 *
 * Los alumnos se derivan de PEOPLE (beneficiarios aprobados del curso), no de los
 * bookings — así es robusto aunque los bookings se hayan borrado.
 */
export async function regenerarCursoPreservandoEstado(
  cursoId: string,
  /**
   * Cómo se rehacen los eventos. Por defecto el motor de MOSAICO (horario semanal).
   * IMPULSA pasa el suyo: su calendario son sesiones L-M-V más entrenamientos y
   * evaluaciones en fechas fijas, y rehacerlo con el de MOSAICO se los borraría.
   */
  regenerarEventos: (curso: any) => Promise<number> = generarEventosCurso,
): Promise<RegenResult> {
  const cursoRow = await query<any>(
    `SELECT "_id","campaign","tipoCurso","salon","guia","horarioCurso",
            "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso", "numeroUsuarios",
            "grupoHorarioId"
     FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`,
    [cursoId]
  );
  const curso = cursoRow.rows[0];
  if (!curso) return { eventos: 0, bookings: 0, alumnos: 0, estadoReaplicado: 0, estadoSinMatch: 0 };

  const est = (await query<any>(
    `SELECT DISTINCT a."_id" AS acaid, a."numeroId", a."primerNombre", a."primerApellido", a."celular", a."plataforma"
     FROM "PEOPLE" p
     JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
     WHERE p."tipoUsuario" = 'BENEFICIARIO'
       AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
       AND ${esAprobadoSql('p."aprobacion"')}
       AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    [curso.campaign, curso.tipoCurso, curso.horarioCurso]
  )).rows;

  const snap = (await query<any>(
    `SELECT b."idEstudiante" AS acaid, (b."fechaEvento")::date AS fecha,
            b."asistio", b."asistencia", b."participacion", b."noAprobo", b."cancelo", b."calificacion", b."comentarios"
     FROM "ACADEMICA_BOOKINGS" b
     JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE c."cursoCampaignId" = $1
       AND ${bookingConRegistroSql('b')}`,
    [cursoId]
  )).rows;

  // 1) Borrar bookings del curso
  await query(
    `DELETE FROM "ACADEMICA_BOOKINGS" b USING "CALENDARIO" c
     WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento") AND c."cursoCampaignId" = $1`,
    [cursoId]
  );

  // 2) Regenerar eventos (el motor por defecto descuenta festivos + suspensiones)
  const eventos = await regenerarEventos(curso);

  // 3) Regenerar bookings por alumno
  let bookings = 0;
  for (const s of est) {
    bookings += await generarBookingsBeneficiario(s.acaid, {
      campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso,
      numeroId: s.numeroId, primerNombre: s.primerNombre, primerApellido: s.primerApellido,
      celular: s.celular, plataforma: s.plataforma,
    });
  }

  // 4) Re-aplicar el estado preservado (por estudiante + fecha), en un solo UPDATE
  //    con arrays paralelos: antes era una consulta por registro guardado.
  let estadoReaplicado = 0, estadoSinMatch = 0;
  if (snap.length) {
    const set = STATE_COLS.map((c, i) => `"${c}" = v.c${i}`).join(', ');
    const cols = STATE_COLS.map((c, i) =>
      `unnest($${i + 4}::${c === 'calificacion' ? 'int' : c === 'comentarios' ? 'text' : 'boolean'}[]) AS c${i}`);
    const r = await query(
      `UPDATE "ACADEMICA_BOOKINGS" b SET ${set}, "_updatedDate" = NOW()
       FROM "CALENDARIO" c,
            (SELECT unnest($2::text[]) AS acaid, unnest($3::date[]) AS fecha, ${cols.join(', ')}) v
       WHERE (c."_id" = b."eventoId" OR c."_id" = b."idEvento") AND c."cursoCampaignId" = $1
         AND b."idEstudiante" = v.acaid AND (b."fechaEvento")::date = v.fecha`,
      [cursoId, snap.map((s: any) => s.acaid), snap.map((s: any) => s.fecha),
       ...STATE_COLS.map((c) => snap.map((s: any) => s[c]))]
    );
    estadoReaplicado = r.rowCount ?? 0;
    estadoSinMatch = Math.max(0, snap.length - estadoReaplicado);
  }

  return { eventos, bookings, alumnos: est.length, estadoReaplicado, estadoSinMatch };
}

export interface BeneficiarioParaBookings {
  campaign?: string | null;
  tipoCurso?: string | null;
  horarioCurso?: string | null;
  numeroId?: string | null;
  primerNombre?: string | null;
  primerApellido?: string | null;
  celular?: string | null;
  plataforma?: string | null;
}

/**
 * Genera los bookings de un beneficiario en TODOS los eventos de su curso.
 *
 * Se invoca en la APROBACIÓN del contrato. Resuelve el curso (campaign + tipoCurso
 * + horarioCurso → cursoCampaignId), trae todos los eventos de CALENDARIO de ese
 * curso e inserta un ACADEMICA_BOOKINGS por evento usando el `academicId`
 * (ACADEMICA._id) como idEstudiante/studentId, subiendo `CALENDARIO.inscritos`.
 *
 * Idempotente: no inserta si el beneficiario ya tiene booking en ese evento.
 * Best-effort desde el caller (no debe romper la aprobación).
 *
 * @returns cantidad de bookings creados.
 */
export interface OpcionesBookings {
  /** Sólo sesiones que aún no han ocurrido. Crear las pasadas dejaría al alumno
   *  marcado AUSENTE en clases donde nunca estuvo inscrito. */
  soloFuturos?: boolean;
  /** Quién lo generó, para el registro del agendamiento. */
  agendadoPor?: string;
}

export async function generarBookingsBeneficiario(
  academicId: string,
  persona: BeneficiarioParaBookings,
  opts: OpcionesBookings = {}
): Promise<number> {
  if (!academicId) return 0;
  if (!persona.campaign || !persona.tipoCurso || !persona.horarioCurso) return 0;

  // Resolver el curso (cursoCampaignId)
  const cr = await query(
    `SELECT "_id" FROM "CURSOS_CAMPAIGN"
     WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,
    [persona.campaign, persona.tipoCurso, persona.horarioCurso]
  );
  const cursoId = cr.rows[0]?._id;
  if (!cursoId) return 0;

  // Eventos del curso
  const ev = await query(
    `SELECT "_id","advisor","dia","hora","tipo","evento","nivel","step",
            "tituloONivel","nombreEvento","titulo","linkZoom"
     FROM "CALENDARIO" WHERE "cursoCampaignId"=$1
       ${opts.soloFuturos ? 'AND "dia" >= NOW()' : ''}`,
    [cursoId]
  );
  if (ev.rows.length === 0) return 0;

  // Dedupe: eventos donde el beneficiario YA tiene booking
  const existing = await query(
    `SELECT "eventoId","idEvento" FROM "ACADEMICA_BOOKINGS"
     WHERE ("idEstudiante"=$1 OR "studentId"=$1)`,
    [academicId]
  );
  const yaTiene = new Set<string>();
  for (const r of existing.rows) {
    if (r.eventoId) yaTiene.add(r.eventoId);
    if (r.idEvento) yaTiene.add(r.idEvento);
  }

  // Un INSERT multi-fila para TODAS las clases que le faltan, y un solo UPDATE
  // para sus contadores. Antes iba de a una: dos viajes a la BD por clase y por
  // alumno — un curso de 88 clases con 10 alumnos hacía 1.760 idas y vueltas, y
  // regenerarlo tardaba más de un minuto. Con esto son dos.
  const pendientes = ev.rows.filter((e: any) => !yaTiene.has(e._id));
  if (pendientes.length === 0) return 0;

  let creados = 0;
  await transaction(async (client) => {
    const filas: any[][] = [];
    let columnas: string[] = [];
    for (const e of pendientes) {
      const bookingData: Record<string, any> = {
        _id: ids.booking(),
        eventoId: e._id,
        idEvento: e._id,
        studentId: academicId,
        idEstudiante: academicId,
        primerNombre: persona.primerNombre || null,
        primerApellido: persona.primerApellido || null,
        numeroId: persona.numeroId || null,
        celular: persona.celular || null,
        plataforma: persona.plataforma || null,
        nivel: e.nivel || e.tituloONivel || null,
        step: e.step || e.nombreEvento || null,
        advisor: e.advisor || '', // ACADEMICA_BOOKINGS.advisor es NOT NULL ('' = sin guía)
        fecha: e.dia,
        fechaEvento: e.dia,
        hora: e.hora || null,
        tipo: e.tipo || e.evento || null,
        tipoEvento: e.tipo || e.evento || null,
        linkZoom: e.linkZoom || null,
        nombreEvento: e.nombreEvento || e.titulo || null,
        tituloONivel: e.tituloONivel || null,
        asistio: false,
        asistencia: false,
        participacion: false,
        noAprobo: false,
        cancelo: false,
        agendadoPor: opts.agendadoPor || 'Sistema (aprobación contrato)',
        fechaAgendamiento: new Date().toISOString(),
        origen: 'POSTGRES',
      };
      if (!columnas.length) columnas = Object.keys(bookingData);
      filas.push(columnas.map((c) => bookingData[c]));
    }

    const params: any[] = [];
    const values = filas.map((f) => {
      const base = params.length;
      params.push(...f);
      return `(${f.map((_, i) => `$${base + i + 1}`).join(', ')}, NOW(), NOW())`;
    });
    await client.query(
      `INSERT INTO "ACADEMICA_BOOKINGS" (${columnas.map((c) => `"${c}"`).join(', ')}, "_createdDate", "_updatedDate")
       VALUES ${values.join(', ')}`,
      params
    );
    // +1 por clase: el alumno entra una sola vez en cada una, así que basta un
    // UPDATE sobre el conjunto.
    await client.query(
      `UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos",0) + 1, "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[])`,
      [pendientes.map((e: any) => e._id)]
    );
    creados = filas.length;
  });
  return creados;
}

/** Identidad de curso de un alumno: lo que lo ata a una fila de CURSOS_CAMPAIGN. */
export interface IdentidadCurso {
  campaign: string;
  tipoCurso: string;
  horarioCurso: string;
  salon?: string | null;
}

/**
 * Mueve a los alumnos de un curso cuando al CURSO le cambian el horario, el salón
 * o el tipo.
 *
 * El curso es el grupo: si el salón de las 19:00 pasa a las 19:15, sus alumnos van
 * con él — no se quedan apuntando a una hora que ya no existe. Sin esto, tras editar
 * el curso los alumnos conservaban la terna vieja en su ficha, la regeneración no
 * encontraba a nadie (busca campaña+curso+horario contra PEOPLE) y el salón quedaba
 * con sus eventos y CERO agendamientos. Pasó con DANSHI · Salón 01 el 18-ago.
 *
 * Qué NO toca, a propósito:
 *   · módulo y lección — es el mismo curso, el alumno conserva su avance;
 *   · las marcas de cupo — el asiento sigue siendo de esta misma fila de curso, así
 *     que el conteo (que va por campaña+curso+horario) lo sigue solo;
 *   · a nadie que no fuera de este curso: sólo mueve a quien tenga EXACTAMENTE la
 *     terna vieja.
 *
 * Deja constancia en `ACADEMICA.cambioAcademicoHistory`, para que la ficha del alumno
 * explique por qué cambió sin que nadie la tocara.
 *
 * Devuelve cuántos alumnos se movieron.
 */
export async function arrastrarAlumnosDelCurso(
  antes: IdentidadCurso,
  despues: IdentidadCurso,
  actor?: { email?: string | null; nombre?: string | null },
): Promise<number> {
  const igual = antes.campaign === despues.campaign
    && antes.tipoCurso === despues.tipoCurso
    && antes.horarioCurso === despues.horarioCurso
    && (antes.salon || '') === (despues.salon || '');
  if (igual) return 0;
  if (!antes.campaign || !antes.tipoCurso || !antes.horarioCurso) return 0;

  const alumnos = (await query<{ _id: string; numeroId: string | null }>(
    `SELECT "_id","numeroId" FROM "PEOPLE"
      WHERE "tipoUsuario"='BENEFICIARIO'
        AND "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3`,
    [antes.campaign, antes.tipoCurso, antes.horarioCurso]
  )).rows;
  if (!alumnos.length) return 0;

  const ids = alumnos.map(a => a._id);
  const numeros = alumnos.map(a => a.numeroId).filter(Boolean) as string[];

  await transaction(async (client) => {
    await client.query(
      `UPDATE "PEOPLE" SET "campaign"=$2, "tipoCurso"=$3, "horarioCurso"=$4, "salon"=$5, "_updatedDate"=NOW()
        WHERE "_id" = ANY($1::text[])`,
      [ids, despues.campaign, despues.tipoCurso, despues.horarioCurso, despues.salon || null]);

    if (numeros.length) {
      await client.query(
        `UPDATE "ACADEMICA" SET "campaign"=$2, "salon"=$3, "_updatedDate"=NOW()
          WHERE "numeroId" = ANY($1::text[])`,
        [numeros, despues.campaign, despues.salon || null]);

      const entrada = {
        fecha: new Date().toISOString(),
        motivo: 'El curso cambió de horario/salón y sus alumnos se movieron con él',
        origen: { campaign: antes.campaign, tipoCurso: antes.tipoCurso, horarioCurso: antes.horarioCurso, salon: antes.salon || null },
        destino: { campaign: despues.campaign, tipoCurso: despues.tipoCurso, horarioCurso: despues.horarioCurso, salon: despues.salon || null },
        realizadoPor: actor?.email || 'sistema',
        realizadoPorNombre: actor?.nombre || null,
        automatico: true,
      };
      await client.query(
        `UPDATE "ACADEMICA"
            SET "cambioAcademicoHistory" =
                  COALESCE("cambioAcademicoHistory", '[]'::jsonb) || $2::jsonb,
                "_updatedDate" = NOW()
          WHERE "numeroId" = ANY($1::text[])`,
        [numeros, JSON.stringify([entrada])]).catch(() => null); // columna opcional
    }
  });

  return alumnos.length;
}
