import 'server-only';
import { query, transaction } from '@/lib/postgres';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { parseHorario, hoyEnChile, TZ_OPERACION } from '@/lib/cursos-campaign';
import { calcularFechasCurso, fechasAmpliacion, addDaysISO } from '@/lib/calendario-curso';
import { cupoOcupadoSql } from '@/lib/cupo';
import { esAprobadoSql } from '@/lib/estados';
import { bookingConRegistroSql } from '@/lib/booking-registro';
import { mapearLeccionesSalon } from './repetir-clase.service';
import { detectarColisionesGuia, mensajeColision } from './colision-guia.service';
import {
  diasSinClaseCurso,
  insertarEventosCurso,
  generarBookingsBeneficiario,
} from './cursos-campaign-eventos.service';

/**
 * Académico › Campañas › Ajuste Cursos.
 *
 *  - CIERRE: adelanta el final del curso. Borra las clases posteriores a la fecha
 *    elegida y sus agendamientos, y fija `finalCurso` y `cierreCurso` en esa fecha.
 *    Sólo quita clases que TODAVÍA NO OCURREN: lo ya dictado no se toca. El curso
 *    pasa a «Cerrado» desde el día siguiente (regla de `estadoCurso`) y su guía
 *    queda libre para otro curso desde ese mismo día, porque la colisión de guía
 *    mide la vigencia con `finalCurso`.
 *  - AMPLIACIÓN: extiende `finalCurso` y agrega SÓLO las clases nuevas, después de
 *    la última existente, con la misma regla del generador (`calcularFechasCurso`):
 *    si luego se regenera el curso, salen las mismas fechas. Agenda a los alumnos
 *    que ocupan cupo y ya están aprobados.
 *
 * No usa la regeneración completa: recrearía todos los eventos con ids nuevos y
 * borraría el cierre de sesión que el guía registró en las clases pasadas.
 *
 * Un curso con al menos un ajuste queda registrado en `ajustesHistory` y ya no se
 * edita desde Gestión. IMPULSA queda fuera: su calendario (sesiones, entrenamientos
 * y evaluaciones) sale de su propia configuración. Los salones agrupados se ajustan
 * juntos, para que sigan compartiendo sus clases.
 */

export type AccionAjuste = 'cierre' | 'ampliacion';
export interface ActorAjuste { email: string | null; nombre: string | null }

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

interface CursoRow {
  _id: string; campaign: string; tipoCurso: string; salon: string | null; guia: string | null;
  guiaNombre: string | null; horarioCurso: string; inicioCurso: string | null; finalCurso: string | null;
  cierreCurso: string | null; numeroUsuarios: number | null; grupoHorarioId: string | null;
}

interface EventoRow { _id: string; fecha: string; pasado: boolean; cerrada: boolean; conRegistro: boolean }

const SELECT_CURSO = `
  SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."guia", g."nombreCompleto" AS "guiaNombre",
         cc."horarioCurso", cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
         cc."cierreCurso"::text AS "cierreCurso", cc."numeroUsuarios", cc."grupoHorarioId"
    FROM "CURSOS_CAMPAIGN" cc
    LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"`;

/* ─────────────────────────── Consulta ─────────────────────────── */

/** Cursos activos (de una campaña o todos) con su calendario real resumido. */
export async function listarCursosAjuste(campaign: string | null) {
  const r = await query<any>(
    `WITH ev AS (
       SELECT c."cursoCampaignId" AS id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE c."dia" < NOW())::int AS dictadas,
              MAX((c."dia" AT TIME ZONE '${TZ_OPERACION}')::date)::text AS "ultimaClase"
         FROM "CALENDARIO" c
        WHERE c."cursoCampaignId" IS NOT NULL
        GROUP BY 1
     )
     SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."guia", g."nombreCompleto" AS "guiaNombre",
            cc."horarioCurso", cc."inicioCurso"::text AS "inicioCurso", cc."finalCurso"::text AS "finalCurso",
            cc."cierreCurso"::text AS "cierreCurso", cc."grupoHorarioId",
            MIN(cc."inicioCurso"::text) OVER (PARTITION BY cc."campaign") AS "inicioCampanaCursos",
            COALESCE(cc."numeroUsuarios", 0) AS "numeroUsuarios",
            (SELECT COUNT(*)::int FROM "PEOPLE" pe
               WHERE pe."tipoUsuario" = 'BENEFICIARIO'
                 AND pe."campaign" = cc."campaign" AND pe."tipoCurso" = cc."tipoCurso"
                 AND pe."horarioCurso" = cc."horarioCurso"
                 AND ${cupoOcupadoSql('pe')}) AS "usuInscritos",
            COALESCE(cc."ajustesHistory", '[]'::jsonb) AS "ajustesHistory",
            COALESCE(ev.total, 0) AS "clasesTotal", COALESCE(ev.dictadas, 0) AS "clasesDictadas",
            ev."ultimaClase"
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN ev ON ev.id = cc."_id"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE cc."activa" = true AND ($1::text IS NULL OR cc."campaign" = $1)
      ORDER BY cc."campaign",
        CASE UPPER(cc."tipoCurso") WHEN 'YOJI' THEN 1 WHEN 'OKINA' THEN 2 WHEN 'KODOMO' THEN 3
                                   WHEN 'DANSHI' THEN 4 WHEN 'SENPAI' THEN 5 WHEN 'IMPULSA' THEN 6 ELSE 9 END,
        cc."salon", cc."horarioCurso"`,
    [campaign || null]
  );
  return r.rows.map((row: any) => ({
    ...row,
    ajustes: Array.isArray(row.ajustesHistory) ? row.ajustesHistory.length : 0,
    esImpulsa: String(row.tipoCurso || '').toUpperCase() === 'IMPULSA',
  }));
}

/* ─────────────────────────── Comunes ─────────────────────────── */

/** El curso y, si comparte salón, todos los de su grupo (él incluido). */
async function cursoYGrupo(cursoId: string): Promise<CursoRow[]> {
  const base = (await query<CursoRow>(`${SELECT_CURSO} WHERE cc."_id" = $1`, [cursoId])).rows[0];
  if (!base) throw new NotFoundError('Curso de campaña', cursoId);
  const grupo = base.grupoHorarioId
    ? (await query<CursoRow>(
        `${SELECT_CURSO} WHERE cc."grupoHorarioId" = $1 AND cc."activa" = true ORDER BY cc."tipoCurso", cc."salon"`,
        [base.grupoHorarioId]
      )).rows
    : [base];
  for (const c of grupo) {
    if (String(c.tipoCurso || '').toUpperCase() === 'IMPULSA') {
      throw new ValidationError('IMPULSA no se ajusta desde aquí: su calendario (sesiones, entrenamientos y evaluaciones) sale de su propia configuración.');
    }
  }
  return grupo.length ? grupo : [base];
}

async function eventosDelCurso(cursoId: string): Promise<EventoRow[]> {
  const evs = (await query<Omit<EventoRow, 'conRegistro'>>(
    `SELECT c."_id",
            (c."dia" AT TIME ZONE '${TZ_OPERACION}')::date::text AS "fecha",
            (c."dia" < NOW()) AS "pasado",
            COALESCE(c."sesionCerrada", false) AS "cerrada"
       FROM "CALENDARIO" c
      WHERE c."cursoCampaignId" = $1
      ORDER BY c."dia"`,
    [cursoId]
  )).rows;
  if (!evs.length) return [];
  // Una sola consulta para todo el curso. Con `= ANY` en cada columna y un OR
  // explícito Postgres usa los índices de eventoId e idEvento; un EXISTS por clase
  // correlacionado con OR recorría los agendamientos una vez por clase (3-5 s).
  const ids = evs.map((e) => e._id);
  const con = (await query<{ id: string }>(
    `SELECT DISTINCT COALESCE(b."eventoId", b."idEvento") AS id
       FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
        AND ${bookingConRegistroSql('b')}`,
    [ids]
  )).rows;
  const conRegistro = new Set(con.map((r) => r.id));
  return evs.map((e) => ({ ...e, conRegistro: conRegistro.has(e._id) }));
}

/** Alumnos que están en el curso en este momento: ocupan cupo y están aprobados. */
async function alumnosDelCurso(c: CursoRow) {
  return (await query<any>(
    `SELECT DISTINCT a."_id" AS acaid, a."numeroId", a."primerNombre", a."primerApellido", a."celular", a."plataforma"
       FROM "PEOPLE" p
       JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
      WHERE p."tipoUsuario" = 'BENEFICIARIO'
        AND p."campaign" = $1 AND p."tipoCurso" = $2 AND p."horarioCurso" = $3
        AND ${esAprobadoSql('p."aprobacion"')}
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
        AND ${cupoOcupadoSql('p')}`,
    [c.campaign, c.tipoCurso, c.horarioCurso]
  )).rows;
}

const nombreCurso = (c: CursoRow) => `${c.tipoCurso} · Salón ${c.salon || '—'} · ${c.horarioCurso}`;

function validarFecha(fecha: string, etiqueta: string) {
  if (!FECHA_RE.test(String(fecha || ''))) throw new ValidationError(`${etiqueta}: fecha inválida (use AAAA-MM-DD).`);
}

/* ─────────────────────────── Cierre ─────────────────────────── */

export async function planCierre(cursoId: string, fecha: string) {
  validarFecha(fecha, 'Fecha de cierre');
  const grupo = await cursoYGrupo(cursoId);
  const cursos = [];
  for (const c of grupo) {
    const evs = await eventosDelCurso(c._id);
    if (!evs.length) throw new ValidationError(`${nombreCurso(c)} no tiene clases.`);
    if (c.inicioCurso && fecha < c.inicioCurso.slice(0, 10)) {
      throw new ValidationError(`La fecha de cierre no puede ser anterior al inicio del curso (${c.inicioCurso.slice(0, 10)}).`);
    }
    const ultimaAntes = evs[evs.length - 1].fecha;
    const aBorrar = evs.filter((e) => e.fecha > fecha);
    if (!aBorrar.length) {
      throw new ValidationError(`${nombreCurso(c)} no tiene clases después del ${fecha}: su última clase es el ${ultimaAntes}.`);
    }
    // Sólo se quitan clases que todavía no ocurren. Una clase pasada —aunque el
    // guía no haya marcado asistencia— se dictó o se debió dictar: es historia.
    const pasadas = aBorrar.filter((e) => e.pasado);
    if (pasadas.length) {
      const ultimaPasada = evs.filter((e) => e.pasado).slice(-1)[0]?.fecha;
      throw new ValidationError(`El cierre sólo puede quitar clases que aún no ocurren. La última clase ya dictada de ${nombreCurso(c)} es el ${ultimaPasada}: elige esa fecha o una posterior.`);
    }
    const conRegistro = aBorrar.filter((e) => e.cerrada || e.conRegistro);
    if (conRegistro.length) {
      throw new ValidationError(`No se puede cerrar: la clase del ${conRegistro[0].fecha} de ${nombreCurso(c)} ya tiene asistencia o cierre registrado.`);
    }
    const ids = aBorrar.map((e) => e._id);
    const bk = (await query<{ n: number; alumnos: number }>(
      `SELECT COUNT(*)::int AS n, COUNT(DISTINCT "idEstudiante")::int AS alumnos
         FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = ANY($1::text[]) OR "idEvento" = ANY($1::text[])`,
      [ids]
    )).rows[0];
    const quedan = evs.filter((e) => e.fecha <= fecha);
    cursos.push({
      _id: c._id, nombre: nombreCurso(c), tipoCurso: c.tipoCurso, salon: c.salon, horarioCurso: c.horarioCurso,
      guia: c.guia, guiaNombre: c.guiaNombre,
      finalAntes: c.finalCurso ? c.finalCurso.slice(0, 10) : null,
      ultimaAntes, ultimaNueva: quedan.length ? quedan[quedan.length - 1].fecha : null,
      clasesAntes: evs.length, clasesBorra: aBorrar.length, clasesQuedan: quedan.length,
      agendamientos: bk?.n || 0, alumnos: bk?.alumnos || 0,
      primeraBorrada: aBorrar[0].fecha,
      _ids: ids,
    });
  }
  return {
    accion: 'cierre' as const, fecha,
    cerradoDesde: addDaysISO(fecha, 1), guiaLibreDesde: addDaysISO(fecha, 1),
    cursos,
  };
}

export async function aplicarCierre(cursoId: string, fecha: string, motivo: string, actor: ActorAjuste) {
  const m = String(motivo || '').trim();
  if (!m) throw new ValidationError('El motivo es obligatorio.');
  const plan = await planCierre(cursoId, fecha);

  await transaction(async (client) => {
    for (const c of plan.cursos) {
      // Defensa: si mientras se confirmaba alguien marcó algo en esas clases, se aborta.
      const reg = await client.query(
        `SELECT COUNT(*)::int AS n FROM "ACADEMICA_BOOKINGS" b
          WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
            AND ${bookingConRegistroSql('b')}`,
        [c._ids]
      );
      if (reg.rows[0].n > 0) throw new ConflictError('Una de las clases a quitar acaba de recibir asistencia. No se cerró nada: vuelve a intentarlo.');

      const delB = await client.query(
        `DELETE FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = ANY($1::text[]) OR "idEvento" = ANY($1::text[])`,
        [c._ids]
      );
      const delE = await client.query(
        `DELETE FROM "CALENDARIO" WHERE "_id" = ANY($1::text[]) AND "cursoCampaignId" = $2`,
        [c._ids, c._id]
      );
      const entrada = {
        tipo: 'CIERRE',
        fecha: new Date().toISOString(),
        motivo: m,
        realizadoPor: actor.email,
        realizadoPorNombre: actor.nombre,
        finalAnterior: c.finalAntes,
        finalNuevo: fecha,
        ultimaClaseAnterior: c.ultimaAntes,
        ultimaClaseNueva: c.ultimaNueva,
        clasesEliminadas: delE.rowCount ?? 0,
        agendamientosEliminados: delB.rowCount ?? 0,
        alumnos: c.alumnos,
        guia: c.guia, guiaNombre: c.guiaNombre,
        guiaLibreDesde: plan.guiaLibreDesde,
        grupo: plan.cursos.length > 1 ? plan.cursos.map((x) => x._id) : undefined,
      };
      await client.query(
        `UPDATE "CURSOS_CAMPAIGN"
            SET "finalCurso" = $2::date, "cierreCurso" = $2::date,
                "ajustesHistory" = COALESCE("ajustesHistory", '[]'::jsonb) || $3::jsonb,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [c._id, fecha, JSON.stringify([entrada])]
      );
      (c as any).resultado = { clasesEliminadas: entrada.clasesEliminadas, agendamientosEliminados: entrada.agendamientosEliminados };
    }
  });

  return {
    ...plan,
    cursos: plan.cursos.map(({ _ids, ...c }: any) => c),
  };
}

/* ─────────────────────────── Ampliación ─────────────────────────── */

export async function planAmpliacion(cursoId: string, nuevoFinal: string) {
  validarFecha(nuevoFinal, 'Nuevo final');
  const grupo = await cursoYGrupo(cursoId);
  const hoy = hoyEnChile();
  const cursos = [];
  for (const c of grupo) {
    const parsed = parseHorario(c.horarioCurso);
    if (!parsed || !c.inicioCurso) throw new ValidationError(`${nombreCurso(c)} no tiene horario o inicio válidos.`);
    const finalAntes = c.finalCurso ? c.finalCurso.slice(0, 10) : null;
    if (finalAntes && nuevoFinal <= finalAntes) {
      throw new ValidationError(`El nuevo final debe ser posterior al Final curso actual (${finalAntes}).`);
    }
    const evs = await eventosDelCurso(c._id);
    const ultimaAntes = evs.length ? evs[evs.length - 1].fecha : null;

    // Mismo cálculo que el generador, con el nuevo final: las clases que faltan son
    // las de ese calendario posteriores a la última existente.
    const objetivo = calcularFechasCurso({
      inicio: c.inicioCurso, fin: nuevoFinal, dias: parsed.dias,
      noHayClase: await diasSinClaseCurso(c._id), max: 2000, hasta: null,
    });
    const todas = fechasAmpliacion(objetivo, ultimaAntes);
    // Nunca se crea una clase en el pasado: el alumno quedaría ausente en una clase
    // que no existió (pasa al ampliar un curso que ya había terminado).
    const nuevas = todas.filter((d) => d >= hoy);
    const omitidas = todas.length - nuevas.length;
    if (!nuevas.length) {
      throw new ValidationError(`Con ese final ${nombreCurso(c)} no gana ninguna clase${ultimaAntes ? ` (su última clase ya es el ${ultimaAntes})` : ''}. Elige una fecha más lejana.`);
    }

    // Extender la vigencia puede chocar con otro curso del mismo guía a la misma hora.
    const colisiones = await detectarColisionesGuia({
      excluirId: c._id, guia: c.guia, campaign: c.campaign, tipoCurso: c.tipoCurso,
      horarioCurso: c.horarioCurso, salon: c.salon, inicioCurso: c.inicioCurso, finalCurso: nuevoFinal,
      grupoHorarioId: c.grupoHorarioId,
    });
    if (colisiones.length) throw new ConflictError(mensajeColision(colisiones));

    const alumnos = await alumnosDelCurso(c);
    cursos.push({
      _id: c._id, nombre: nombreCurso(c), tipoCurso: c.tipoCurso, salon: c.salon, horarioCurso: c.horarioCurso,
      guia: c.guia, guiaNombre: c.guiaNombre,
      finalAntes, ultimaAntes, cierreAntes: c.cierreCurso ? c.cierreCurso.slice(0, 10) : null,
      clasesAntes: evs.length, clasesNuevas: nuevas.length, omitidasPasadas: omitidas,
      desde: nuevas[0], hasta: nuevas[nuevas.length - 1],
      alumnos: alumnos.length,
      _curso: c, _fechas: nuevas, _alumnos: alumnos,
    });
  }
  return { accion: 'ampliacion' as const, nuevoFinal, cursos };
}

export async function aplicarAmpliacion(cursoId: string, nuevoFinal: string, motivo: string, actor: ActorAjuste) {
  const m = String(motivo || '').trim();
  if (!m) throw new ValidationError('El motivo es obligatorio.');
  const plan = await planAmpliacion(cursoId, nuevoFinal);

  // 1) Clases nuevas + nuevo final + registro, en UNA transacción: o queda todo o nada.
  await transaction(async (client) => {
    for (const c of plan.cursos as any[]) {
      const creadas = await insertarEventosCurso(c._curso, c._fechas, client);
      const entrada = {
        tipo: 'AMPLIACION',
        fecha: new Date().toISOString(),
        motivo: m,
        realizadoPor: actor.email,
        realizadoPorNombre: actor.nombre,
        finalAnterior: c.finalAntes,
        finalNuevo: nuevoFinal,
        cierreAnterior: c.cierreAntes,
        ultimaClaseAnterior: c.ultimaAntes,
        ultimaClaseNueva: c.hasta,
        clasesAgregadas: creadas,
        alumnos: c.alumnos,
        guia: c.guia, guiaNombre: c.guiaNombre,
        grupo: plan.cursos.length > 1 ? plan.cursos.map((x: any) => x._id) : undefined,
      };
      // Ampliar levanta un cierre anterior: sin eso el generador seguiría cortando ahí.
      await client.query(
        `UPDATE "CURSOS_CAMPAIGN"
            SET "finalCurso" = $2::date, "cierreCurso" = NULL,
                "ajustesHistory" = COALESCE("ajustesHistory", '[]'::jsonb) || $3::jsonb,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [c._id, nuevoFinal, JSON.stringify([entrada])]
      );
    }
  });

  // 2) Lecciones de las clases nuevas (sigue la secuencia; las existentes no cambian)
  //    y agendamientos de los alumnos del curso. Idempotente: si algo falla a medias,
  //    volver a generar agendamientos no duplica.
  const resultados = [];
  for (const c of plan.cursos as any[]) {
    try { await mapearLeccionesSalon(c._id); } catch { /* best-effort */ }
    let agendamientos = 0;
    const fallidos: string[] = [];
    for (const s of c._alumnos) {
      try {
        agendamientos += await generarBookingsBeneficiario(s.acaid, {
          campaign: c._curso.campaign, tipoCurso: c._curso.tipoCurso, horarioCurso: c._curso.horarioCurso,
          numeroId: s.numeroId, primerNombre: s.primerNombre, primerApellido: s.primerApellido,
          celular: s.celular, plataforma: s.plataforma,
        }, { soloFuturos: true, agendadoPor: 'Sistema (ampliación de curso)' });
      } catch {
        fallidos.push([s.primerNombre, s.primerApellido].filter(Boolean).join(' ') || s.acaid);
      }
    }
    const sinLeccion = (await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "CALENDARIO"
        WHERE "cursoCampaignId" = $1
          AND ("dia" AT TIME ZONE '${TZ_OPERACION}')::date = ANY($2::date[])
          AND "sesionLeccion" IS NULL`,
      [c._id, c._fechas]
    )).rows[0]?.n || 0;
    const { _curso, _fechas, _alumnos, ...visible } = c;
    resultados.push({ ...visible, agendamientos, sinLeccion, fallidos });
  }
  return { accion: 'ampliacion' as const, nuevoFinal, cursos: resultados };
}

/** Vista previa (sin escribir) para el modal: quita los campos internos. */
export async function previsualizarAjuste(cursoId: string, accion: AccionAjuste, fecha: string) {
  if (accion === 'cierre') {
    const p = await planCierre(cursoId, fecha);
    return { ...p, cursos: p.cursos.map(({ _ids, ...c }: any) => c) };
  }
  if (accion === 'ampliacion') {
    const p = await planAmpliacion(cursoId, fecha);
    return { ...p, cursos: p.cursos.map(({ _curso, _fechas, _alumnos, ...c }: any) => c) };
  }
  throw new ValidationError('Acción inválida.');
}
