/**
 * Progress Service — "¿Cómo voy?" de MOSAICO (Fase 1).
 *
 * Modelo MOSAICO: Curso → Módulos → Lecciones (1 sesión c/u, en secuencia por fecha).
 * Cada sesión de CALENDARIO trae su lección en `sesionModulo`/`sesionLeccion`/`leccionOrden`
 * (poblado por `mapearLeccionesSalon`). El booking del alumno apunta a esa sesión.
 *
 * Reglas (Fase 1):
 *   - Lección APROBADA  = el Guía marcó asistencia (asistio/asistencia=true) y NO marcó
 *     "No aprobó" (noAprobo). (Reutiliza los toggles que ya existen en /sesion/[id].)
 *   - Lección NO APROBADA = asistió pero el Guía marcó noAprobo.
 *   - AUSENTE = la sesión ya pasó y no asistió → "consulta a tu guía para ponerte al día".
 *   - PROGRAMADA = la sesión es futura.
 *   - REFUERZO = la lección aparece repetida en la secuencia (repetir lección del salón).
 *   - Módulo completo (Fase 1) = todas sus lecciones aprobadas. La EVALUACIÓN de módulo
 *     y el gate de avance llegan en Fase 2.
 *   - Nivelación: se expone si el alumno tiene `ACADEMICA.nivelacion=true`.
 *
 * NOTA: el motor de Steps/Jumps/TRAINING de LGS fue reemplazado por completo.
 */

import 'server-only';
import { queryMany, queryOne } from '@/lib/postgres';
import { NotFoundError } from '@/lib/errors';
import { EVALUACION_STEP } from './repetir-clase.service';
import { isExitosa } from '@/lib/motor-academico';

// --- Helpers ---
const stripAccents = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: any) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
const isAttended = isExitosa;   // misma regla, ver lib/motor-academico
const EVAL_KEY = norm(EVALUACION_STEP);

interface AcademicaRow {
  _id: string; numeroId: string | null;
  primerNombre: string | null; primerApellido: string | null;
  curso: string | null; nivel: string | null; step: string | null;
  campaign: string | null; salon: string | null;
  nivelacion: boolean | null; aprobadoNivelacion: boolean | null; detalleNivelacion: any;
}

/** Resuelve el registro ACADEMICA desde un id (ACADEMICA._id, numeroId o PEOPLE._id). */
async function resolveAcademica(studentId: string): Promise<{ aca: AcademicaRow | null; tipoCursoPeople: string | null; nombrePeople: string | null }> {
  const SEL = `"_id","numeroId","primerNombre","primerApellido","curso","nivel","step","campaign","salon","nivelacion","aprobadoNivelacion","detalleNivelacion"`;
  let aca = await queryOne<AcademicaRow>(`SELECT ${SEL} FROM "ACADEMICA" WHERE "_id"=$1 LIMIT 1`, [studentId]);
  let tipoCursoPeople: string | null = null;
  let nombrePeople: string | null = null;

  if (!aca) {
    // ¿es un PEOPLE._id o un numeroId?
    const person = await queryOne<any>(
      `SELECT "_id","numeroId","tipoCurso","primerNombre","primerApellido" FROM "PEOPLE" WHERE "_id"=$1 OR "numeroId"=$1
       ORDER BY CASE WHEN "tipoUsuario"='BENEFICIARIO' THEN 0 ELSE 1 END LIMIT 1`, [studentId]);
    if (person) {
      tipoCursoPeople = person.tipoCurso || null;
      nombrePeople = [person.primerNombre, person.primerApellido].filter(Boolean).join(' ') || null;
      if (person.numeroId) {
        aca = await queryOne<AcademicaRow>(
          `SELECT ${SEL} FROM "ACADEMICA" WHERE "numeroId"=$1
           ORDER BY CASE WHEN "tipoUsuario"='BENEFICIARIO' THEN 0 ELSE 1 END LIMIT 1`, [person.numeroId]);
      }
    }
  } else if (aca.numeroId) {
    const person = await queryOne<any>(`SELECT "tipoCurso" FROM "PEOPLE" WHERE "numeroId"=$1 AND "tipoCurso" IS NOT NULL LIMIT 1`, [aca.numeroId]);
    tipoCursoPeople = person?.tipoCurso || null;
  }
  return { aca, tipoCursoPeople, nombrePeople };
}

/**
 * Genera el reporte de progreso de MOSAICO para un alumno.
 */
export async function generateReport(studentId: string) {
  const { aca, tipoCursoPeople, nombrePeople } = await resolveAcademica(studentId);
  if (!aca && !tipoCursoPeople) throw new NotFoundError('Student', studentId);

  const academicaId = aca?._id || studentId;
  const nombre = [aca?.primerNombre, aca?.primerApellido].filter(Boolean).join(' ') || nombrePeople || '';
  // El curso real: si ACADEMICA sigue en el puente WELCOME, usar el de PEOPLE.
  const cursoAca = aca?.curso && aca.curso !== 'WELCOME' ? aca.curso : null;
  const curso = cursoAca || tipoCursoPeople || aca?.curso || null;
  const moduloActual = aca?.nivel || null;
  const leccionActual = aca?.step || null;

  // 1. Estructura del curso: módulos → lecciones (NIVELES por curso, ordenado).
  const nivelesRows = curso
    ? await queryMany<{ code: string; step: string; orden: number | null }>(
        `SELECT "code","step","orden" FROM "NIVELES" WHERE "curso"=$1 AND "step" <> 'WELCOME'
         ORDER BY "orden" NULLS LAST, "code","step"`, [curso])
    : [];

  const moduleOrder: string[] = [];
  const moduleMap = new Map<string, { code: string; lessons: Array<{ step: string; orden: number | null }>; seen: Set<string> }>();
  for (const r of nivelesRows) {
    if (!moduleMap.has(r.code)) { moduleMap.set(r.code, { code: r.code, lessons: [], seen: new Set() }); moduleOrder.push(r.code); }
    const m = moduleMap.get(r.code)!;
    const key = norm(r.step);
    if (!m.seen.has(key)) { m.seen.add(key); m.lessons.push({ step: r.step, orden: r.orden }); }
  }

  // 2. Bookings del alumno con la lección de su sesión (post-backfill mapearLeccionesSalon).
  //    Una clase de dos horas trae DOS lecciones (`sesionLeccion2`, ver `lib/bloques-leccion`).
  const bookings = academicaId
    ? await queryMany<any>(
        `SELECT c."sesionModulo" AS "sm", c."sesionLeccion" AS "sl", c."leccionOrden" AS "lo",
                c."sesionModulo2" AS "sm2", c."sesionLeccion2" AS "sl2",
                c."dia" AS "dia", c."tipo" AS "tipo",
                b."asistio", b."asistencia", b."noAprobo", b."cancelo", b."movimientoAcademico"
         FROM "ACADEMICA_BOOKINGS" b
         JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
         WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)`, [academicaId])
    : [];

  // Índice de bookings por lección (módulo||lección normalizados). Puede haber >1 = refuerzo.
  //
  // Una sesión de dos bloques se indexa bajo SUS DOS lecciones: quien asiste aprueba
  // las dos. Se indexa el mismo booking, no una copia, porque es UNA sola clase — las
  // estadísticas de asistencia siguen contándola una vez.
  const byLesson = new Map<string, any[]>();
  const indexar = (bk: any, mod: any, lec: any) => {
    if (!lec) return;
    const key = `${norm(mod)}||${norm(lec)}`;
    if (!byLesson.has(key)) byLesson.set(key, []);
    byLesson.get(key)!.push(bk);
  };
  for (const bk of bookings) {
    indexar(bk, bk.sm, bk.sl);
    indexar(bk, bk.sm2, bk.sl2);
  }

  const now = Date.now();
  const t = (d: any) => (d ? new Date(d).getTime() : null);

  function statusLeccion(instances: any[], esEval = false) {
    const refuerzo = instances.length > 1;
    const past = instances.filter((b) => { const tt = t(b.dia); return tt !== null && tt <= now; });
    const future = instances.filter((b) => { const tt = t(b.dia); return tt === null || tt > now; });
    const aprobada = instances.some((b) => isAttended(b) && b.noAprobo !== true && b.cancelo !== true);
    const noAprobada = !aprobada && instances.some((b) => isAttended(b) && b.noAprobo === true);
    // Aprobada por Movimiento Académico (no por asistencia real).
    const movimiento = aprobada && instances.some((b) => isAttended(b) && b.noAprobo !== true && b.movimientoAcademico === true);
    // fecha representativa: última pasada, si no la primera futura
    const repDate = (past.length ? past[past.length - 1] : future[0])?.dia || null;
    const cosa = esEval ? 'la evaluación' : 'esta sesión';

    let estado: 'aprobada' | 'no_aprobada' | 'ausente' | 'programada' | 'pendiente';
    let mensaje: string | null = null;
    if (aprobada) { estado = 'aprobada'; }
    else if (noAprobada) { estado = 'no_aprobada'; mensaje = `No ${esEval ? 'aprobaste la evaluación' : 'aprobaste esta lección'}. Consulta a tu guía.`; }
    else if (past.length && past.every((b) => b.cancelo === true)) { estado = 'ausente'; mensaje = `Cancelaste ${cosa}. Consulta a tu guía para reagendar.`; }
    else if (past.length) { estado = 'ausente'; mensaje = `No asististe a ${cosa}. Consulta a tu guía para ponerte al día.`; }
    else if (future.length) { estado = 'programada'; }
    else { estado = 'pendiente'; }
    return { estado, mensaje, refuerzo, fecha: repDate, movimiento };
  }

  // 3. Construir módulos (lecciones + evaluación del módulo).
  const modulos = moduleOrder.map((code) => {
    const m = moduleMap.get(code)!;
    const lecciones = m.lessons.map((L, i) => {
      const key = `${norm(code)}||${norm(L.step)}`;
      const st = statusLeccion(byLesson.get(key) || []);
      return { orden: L.orden ?? i + 1, leccion: L.step, ...st };
    });
    const total = lecciones.length;
    const aprobadas = lecciones.filter((l) => l.estado === 'aprobada').length;
    const leccionesOk = total > 0 && aprobadas === total;

    // Evaluación del módulo (sesión con sesionLeccion='Evaluación').
    const evalInstances = byLesson.get(`${norm(code)}||${EVAL_KEY}`) || [];
    const evaluacion = evalInstances.length
      ? (() => { const st = statusLeccion(evalInstances, true); return { ...st, disponible: leccionesOk }; })()
      : null;
    const evalAprobada = evaluacion?.estado === 'aprobada';
    // Completo = todas las lecciones aprobadas Y (si hay evaluación) evaluación aprobada.
    const completo = leccionesOk && (evaluacion ? evalAprobada : true);
    // Faltan = lecciones no aprobadas + (1 si la evaluación existe y no está aprobada).
    const faltan = Math.max(0, total - aprobadas) + (evaluacion && !evalAprobada ? 1 : 0);

    return {
      modulo: code,
      esActual: !!moduloActual && code === moduloActual,
      total, aprobadas,
      porcentaje: total ? Math.round((aprobadas / total) * 100) : 0,
      faltan,
      leccionesOk,
      completo,
      evaluacion,
      lecciones,
    };
  });

  // Módulo "actual": el marcado por ACADEMICA, si no el primero incompleto, si no el último.
  const modActual = modulos.find((m) => m.esActual)
    || modulos.find((m) => !m.completo)
    || modulos[modulos.length - 1] || null;

  // 4. Estadísticas de asistencia (todas las clases pasadas del alumno).
  const pastAll = bookings.filter((b) => { const tt = t(b.dia); return tt !== null && tt <= now; });
  const totalClases = pastAll.length;
  const totalAsistencias = pastAll.filter(isAttended).length;
  const totalAusencias = pastAll.filter((b) => b.cancelo !== true && !isAttended(b)).length;
  const porcentajeAsistencia = totalClases ? Math.round((totalAsistencias / totalClases) * 100) : 0;

  // 5. Nivelación (dato ya existente en ACADEMICA).
  let nivelacion: any = null;
  if (aca?.nivelacion === true) {
    let det: any = aca.detalleNivelacion;
    if (typeof det === 'string') { try { det = JSON.parse(det); } catch { det = null; } }
    nivelacion = {
      activa: true,
      modulo: det?.modulo || null,
      leccion: det?.leccion || null,
      aprobada: aca.aprobadoNivelacion === true,
    };
  }

  const mapeoPendiente = curso != null && nivelesRows.length > 0 && bookings.length > 0
    && !bookings.some((b) => b.sl);

  return {
    student: {
      _id: academicaId,
      numeroId: aca?.numeroId || null,
      nombre,
      curso,
      campaign: aca?.campaign || null,
      salon: aca?.salon || null,
      moduloActual,
      leccionActual,
    },
    resumen: {
      curso,
      moduloActual: modActual?.modulo || moduloActual || null,
      modulosCompletos: modulos.filter((m) => m.completo).length,
      totalModulos: modulos.length,
      leccionesAprobadasModulo: modActual?.aprobadas || 0,
      totalLeccionesModulo: modActual?.total || 0,
      porcentajeModulo: modActual?.porcentaje || 0,
      faltanModulo: modActual?.faltan || 0,
      totalClases, totalAsistencias, totalAusencias, porcentajeAsistencia,
      mapeoPendiente,
    },
    modulos,
    nivelacion,
  };
}
