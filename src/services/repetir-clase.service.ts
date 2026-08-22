import 'server-only';
import { query, queryMany, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';
import { parseHorario, fechasEntre } from '@/lib/cursos-campaign';
import { leccionesDeSesion } from '@/lib/bloques-leccion';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { EVALUACION_STEP } from '@/lib/evaluacion';
import { asignarLeccionesImpulsa } from './impulsa-calendario.service';

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * "Repetir Lección" — camino B (mapeo sesión→lección).
 *
 * Cada sesión (evento de CALENDARIO ligado a un CURSOS_CAMPAIGN) cubre una lección
 * del curso, en secuencia por fecha. La secuencia base son las lecciones de NIVELES
 * (por `orden`); cada repetición autorizada DUPLICA su lección en el punto donde va,
 * empujando las siguientes una posición. Así el módulo/lección de cada sesión queda
 * registrado y el avance se "detiene" una lección tras cada repetición.
 */

export interface LeccionSeq { code: string; step: string; esEvaluacion?: boolean }

export { EVALUACION_STEP };

/** Secuencia expandida = lecciones base + repeticiones autorizadas insertadas. */
export function expandirSecuencia(base: LeccionSeq[], repeticiones: Array<{ modulo: string; leccion: string }>): LeccionSeq[] {
  const seq = [...base];
  for (const rep of repeticiones) {
    const idx = seq.findIndex(l => !l.esEvaluacion && l.code === rep.modulo && l.step === rep.leccion);
    if (idx >= 0) seq.splice(idx + 1, 0, seq[idx]); // duplica la lección repetida
  }
  return seq;
}

/**
 * Lecciones base del curso: EXACTAMENTE las filas de NIVELES, en su `orden`.
 *
 * El currículo declara TODO — las evaluaciones y los entrenamientos son módulos
 * propios (`Evaluacion 01`, `Entrenamiento 02`) con su lección y su contenido, y
 * no es regla que tras cada módulo venga una evaluación: cada curso define las
 * suyas. Así el área académica controla la secuencia desde NIVELES, sin deploy.
 *
 * `sinteticas` reproduce la secuencia ANTERIOR (una evaluación inventada al cierre
 * de cada módulo). Existe sólo para los salones que ya la dictaron: quitársela
 * correría sus clases ya dadas. Ver `CURSOS_CAMPAIGN."evalSinteticaPorModulo"`.
 */
export async function leccionesBaseCurso(tipoCurso: string, sinteticas = false): Promise<LeccionSeq[]> {
  const rows = await queryMany<{ code: string; step: string }>(
    `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 AND "step" <> 'WELCOME' ORDER BY "orden" NULLS LAST, "step"`, [tipoCurso]
  );
  // Camino normal: la secuencia ES el currículo, sin añadidos.
  if (!sinteticas) return rows.map(r => ({ code: r.code, step: r.step }));

  // ── Secuencia LEGACY (sólo salones que ya dictaron las evaluaciones sintéticas).
  //    Reproduce el comportamiento ORIGINAL tal cual — evaluación tras CADA módulo,
  //    inducción incluida: esos salones ya dictaron esas sesiones, y quitarles una
  //    correría todas las siguientes.
  const seq: LeccionSeq[] = [];
  let prevCode: string | null = null;
  for (const r of rows) {
    if (prevCode !== null && r.code !== prevCode) {
      seq.push({ code: prevCode, step: EVALUACION_STEP, esEvaluacion: true }); // eval del módulo que cierra
    }
    seq.push({ code: r.code, step: r.step });
    prevCode = r.code;
  }
  if (prevCode !== null) {
    seq.push({ code: prevCode, step: EVALUACION_STEP, esEvaluacion: true }); // eval del último módulo
  }
  return seq;
}

/**
 * Recalcula el mapeo sesión→lección de un salón (por cursoCampaignId). Recorre las
 * sesiones por fecha repartiendo la secuencia expandida: una lección cada una, y
 * DOS si la clase dura dos horas (los sábados, en las campañas desde AGOSTO 2026).
 * Idempotente.
 * NO crea sesiones nuevas ni extiende — eso lo hace la autorización.
 */
export async function mapearLeccionesSalon(cursoCampaignId: string): Promise<number> {
  type CursoMapeo = { tipoCurso: string; horarioCurso: string | null; inicioCurso: string | null; historicRepet: any; sinteticas: boolean | null };
  const cc = await queryOne<CursoMapeo>(
    `SELECT "tipoCurso","historicRepet",
            "horarioCurso", "inicioCurso"::text AS "inicioCurso",
            COALESCE("evalSinteticaPorModulo", false) AS "sinteticas"
       FROM "CURSOS_CAMPAIGN" WHERE "_id"=$1`, [cursoCampaignId]
  ).catch(() => queryOne<CursoMapeo>(
    `SELECT "tipoCurso","horarioCurso","inicioCurso"::text AS "inicioCurso","historicRepet", false AS "sinteticas" FROM "CURSOS_CAMPAIGN" WHERE "_id"=$1`, [cursoCampaignId]
  ));
  if (!cc) return 0;

  // IMPULSA no sigue la secuencia lección-a-lección de los cursos MOSAICO: sus
  // sesiones son de tres tipos (SESSION / ENTRENAMIENTO / EVALUACION) y cada uno
  // avanza por su propia lista de módulos. Tiene asignador propio; el genérico le
  // pisaría las etiquetas.
  if (String(cc.tipoCurso || '').toUpperCase() === 'IMPULSA') {
    await asignarLeccionesImpulsa(cursoCampaignId);
    const n = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int n FROM "CALENDARIO" WHERE "cursoCampaignId"=$1`, [cursoCampaignId]);
    return n?.n || 0;
  }

  const base = await leccionesBaseCurso(cc.tipoCurso, cc.sinteticas === true);
  const hist = Array.isArray(cc.historicRepet) ? cc.historicRepet : [];
  const reps = hist.filter((h: any) => h?.modulo && h?.leccion).map((h: any) => ({ modulo: h.modulo, leccion: h.leccion }));
  const seq = expandirSecuencia(base, reps);

  const sesiones = await queryMany<{ _id: string; fecha: string }>(
    `SELECT "_id", "fecha"::text AS "fecha" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC`, [cursoCampaignId]
  );
  if (sesiones.length === 0) return 0;

  // Batch: un solo UPDATE con arrays paralelos (antes: 1 query por sesión).
  //
  // El cursor `k` avanza por la SECUENCIA, no por las sesiones: una clase de dos
  // horas consume DOS entradas. Por eso `leccionOrden` —que Movimiento Académico
  // usa para saber si un cambio va adelante o atrás— es la posición de la PRIMERA
  // lección de la sesión, y la segunda ocupa la siguiente.
  const idsArr: string[] = [];
  const ordArr: Array<number | null> = [];
  const modArr: Array<string | null> = [];
  const lecArr: Array<string | null> = [];
  const mod2Arr: Array<string | null> = [];
  const lec2Arr: Array<string | null> = [];
  let k = 0;
  for (const s of sesiones) {
    const cuantas = leccionesDeSesion(s.fecha, cc.horarioCurso, cc.inicioCurso);
    const l1 = seq[k];
    // La segunda, sólo si la sesión es de dos bloques Y queda lección por dictar:
    // la última clase de un curso puede cerrar con una sola.
    const l2 = cuantas === 2 ? seq[k + 1] : undefined;
    idsArr.push(s._id);
    ordArr.push(l1 ? k + 1 : null);
    modArr.push(l1?.code || null);
    lecArr.push(l1?.step || null);
    mod2Arr.push(l2?.code || null);
    lec2Arr.push(l2?.step || null);
    k += cuantas;
  }
  await query(
    `UPDATE "CALENDARIO" c
       SET "leccionOrden" = v.ord, "sesionModulo" = v."mod", "sesionLeccion" = v.lec,
           "sesionModulo2" = v.mod2, "sesionLeccion2" = v.lec2, "_updatedDate" = NOW()
     FROM (SELECT unnest($1::text[]) AS id, unnest($2::int[]) AS ord,
                  unnest($3::text[]) AS "mod", unnest($4::text[]) AS lec,
                  unnest($5::text[]) AS mod2, unnest($6::text[]) AS lec2) v
     WHERE c."_id" = v.id`,
    [idsArr, ordArr, modArr, lecArr, mod2Arr, lec2Arr]
  );
  return sesiones.length;
}

/**
 * Autoriza una solicitud de "Repetir Lección": registra en historicRepet, extiende
 * el curso por semanas completas si faltan sesiones (crea eventos + bookings para
 * los usuarios del salón), re-mapea la secuencia y marca el evento autorizado.
 * Requiere que el salón tenga usuarios inscritos.
 */
export async function autorizarRepetir(eventoId: string, comentario: string, autorizadoPor: string) {
  const ev = await queryOne<any>(
    `SELECT c."_id", c."advisor", c."repetirLeccion", c."cursoCampaignId", c."linkZoom",
            cc."tipoCurso", cc."campaign", cc."salon", cc."horarioCurso", cc."numeroUsuarios"
     FROM "CALENDARIO" c LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
     WHERE c."_id" = $1`, [eventoId]);
  if (!ev) throw new NotFoundError('Evento', eventoId);
  if (!ev.cursoCampaignId) throw new ValidationError('El evento no está ligado a un curso de campaña.');

  // Estudiantes del salón (de los bookings del curso). Gate: ≥1 usuario.
  const students = await queryMany<any>(
    `SELECT DISTINCT b."idEstudiante" AS acaid, a."primerNombre", a."primerApellido",
            a."numeroId", a."celular", a."plataforma"
     FROM "ACADEMICA_BOOKINGS" b
     JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     LEFT JOIN "ACADEMICA" a ON a."_id" = b."idEstudiante"
     WHERE c."cursoCampaignId" = $1 AND b."idEstudiante" IS NOT NULL`, [ev.cursoCampaignId]);
  if (students.length === 0) throw new ValidationError('El salón no tiene usuarios inscritos; no se puede repetir la lección.');

  const [modulo, leccion] = String(ev.repetirLeccion || '').split(' - ').map((s) => s.trim());

  // 1) Registrar la autorización en historicRepet.
  const entry = { fecha: new Date().toISOString(), autorizadoPor, comentario: comentario || '', advisor: ev.advisor || null, modulo: modulo || null, leccion: leccion || null };
  await query(
    `UPDATE "CURSOS_CAMPAIGN" SET "historicRepet" = COALESCE("historicRepet",'[]'::jsonb) || $2::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [ev.cursoCampaignId, JSON.stringify([entry])]
  );

  // 2) ¿Faltan sesiones? needed = lecciones base + repeticiones autorizadas.
  const histRow = await queryOne<any>(
    `SELECT "historicRepet", COALESCE("evalSinteticaPorModulo", false) AS "sinteticas" FROM "CURSOS_CAMPAIGN" WHERE "_id" = $1`,
    [ev.cursoCampaignId]);
  const base = await leccionesBaseCurso(ev.tipoCurso, histRow?.sinteticas === true);
  const hist = Array.isArray(histRow?.historicRepet) ? histRow.historicRepet : [];
  const needed = base.length + hist.filter((h: any) => h?.modulo && h?.leccion).length;
  const curN = (await queryOne<{ n: number }>(`SELECT COUNT(*)::int n FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [ev.cursoCampaignId]))?.n || 0;
  const lastDia = (await queryOne<{ dia: string }>(`SELECT MAX("dia") AS dia FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [ev.cursoCampaignId]))?.dia;

  let sesionesCreadas = 0;
  let nuevoFinal: string | null = null;
  const parsed = parseHorario(ev.horarioCurso);
  if (curN < needed && lastDia && parsed) {
    // Agregar SEMANAS COMPLETAS hasta cubrir las sesiones faltantes.
    const nuevas: string[] = [];
    let cursor = String(lastDia).slice(0, 10);
    let guard = 0;
    while (curN + nuevas.length < needed && guard < 20) {
      nuevas.push(...fechasEntre(addDaysISO(cursor, 1), addDaysISO(cursor, 7), parsed.dias));
      cursor = addDaysISO(cursor, 7);
      guard++;
    }
    const hora = parsed.hora.length === 4 ? `0${parsed.hora}` : parsed.hora;
    const titulo = [ev.campaign, ev.tipoCurso, ev.salon].filter(Boolean).join(' - ');
    for (const fecha of nuevas) {
      const eid = ids.event();
      await query(
        `INSERT INTO "CALENDARIO" ("_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","linkZoom","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","_createdDate","_updatedDate")
         VALUES ($1,'SESSION','SESSION',$2,$3,$4::timestamp AT TIME ZONE 'America/Santiago',$5,$6,$7,$7,$8,$9,$10,$11,$12,'POSTGRES',false,NOW(),NOW())`,
        [eid, fecha, hora, `${fecha} ${hora}:00`, ev.advisor || '', ev.tipoCurso, titulo, ev.horarioCurso, ev.linkZoom || null, ev.numeroUsuarios || 12, ev.cursoCampaignId, students.length]
      );
      for (const st of students) {
        await query(
          `INSERT INTO "ACADEMICA_BOOKINGS" ("_id","eventoId","idEvento","studentId","idEstudiante","primerNombre","primerApellido","numeroId","celular","plataforma","nivel","step","advisor","fecha","fechaEvento","hora","tipo","tipoEvento","nombreEvento","tituloONivel","asistio","asistencia","participacion","noAprobo","cancelo","agendadoPor","fechaAgendamiento","origen","_createdDate","_updatedDate")
           VALUES ($1,$2,$2,$3,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$11,$12,'SESSION','SESSION',$13,$13,false,false,false,false,false,'Sistema (repetir lección)',NOW(),'POSTGRES',NOW(),NOW())`,
          [ids.booking(), eid, st.acaid, st.primerNombre || null, st.primerApellido || null, st.numeroId || null, st.celular || null, st.plataforma || null, ev.tipoCurso, ev.advisor || null, `${fecha} ${hora}:00`, hora, titulo]
        );
      }
      sesionesCreadas++;
      nuevoFinal = fecha;
    }
    if (nuevoFinal) {
      await query(`UPDATE "CURSOS_CAMPAIGN" SET "finalCurso" = $2::date, "_updatedDate" = NOW() WHERE "_id" = $1`, [ev.cursoCampaignId, nuevoFinal]);
    }
  }

  // 3) Re-mapear la secuencia (la repetición ya está en historicRepet).
  await mapearLeccionesSalon(ev.cursoCampaignId);

  // 4) Marcar el evento autorizado (sale de pendientes).
  await query(
    `UPDATE "CALENDARIO" SET "autorizadoRepetir" = true, "fechaAutorizadoRepetir" = NOW(), "autorizadoRepetirPor" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [eventoId, autorizadoPor]
  );

  return {
    curso: ev.tipoCurso, salon: ev.salon, campaign: ev.campaign,
    leccion: ev.repetirLeccion, estudiantes: students.length,
    sesionesCreadas, nuevoFinalCurso: nuevoFinal,
  };
}

/**
 * Rechaza una solicitud: decrementa repetClass, anula la marca del evento y NO
 * toca finalCurso ni historicRepet.
 */
export async function rechazarRepetir(eventoId: string) {
  const ev = await queryOne<{ cursoCampaignId: string | null; repetirSesion: boolean | null }>(
    `SELECT "cursoCampaignId","repetirSesion" FROM "CALENDARIO" WHERE "_id" = $1`, [eventoId]);
  if (!ev) throw new NotFoundError('Evento', eventoId);

  await query(
    `UPDATE "CALENDARIO" SET "repetirSesion" = false, "repetirLeccion" = NULL, "fechaRepetirSesion" = NULL, "autorizadoRepetir" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [eventoId]
  );
  if (ev.repetirSesion === true && ev.cursoCampaignId) {
    await query(`UPDATE "CURSOS_CAMPAIGN" SET "repetClass" = GREATEST(0, COALESCE("repetClass",0) - 1), "_updatedDate" = NOW() WHERE "_id" = $1`, [ev.cursoCampaignId]);
  }
  return { rechazado: true };
}
