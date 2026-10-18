/**
 * Panel del guía — de los datos crudos a las métricas de cada alumno (cliente + servidor).
 *
 * El servicio trae TODO en una sola consulta (agendamientos, casos, evaluaciones,
 * correcciones del Reporte Académico) y aquí se calcula, con funciones puras para
 * poder probarlas. Las reglas son las mismas de «¿Cómo voy?» (`progress.service`)
 * y del Reporte Académico; no se reescriben en SQL para que no diverjan.
 *
 * Período: sólo cuentan las clases del CURSO actual (eventos de su
 * `cursoCampaignId`) ya ocurridas. No hay fecha de inscripción fiable, pero no hace
 * falta: el alumno sólo tiene agendamiento en las clases posteriores a su entrada.
 * Casos, nivelaciones y correcciones de criterios se acotan desde `inicioCurso`.
 */
import { isExitosa } from './motor-academico';
import { cierraElCaso } from './casos-atencion-estados';
import { lunesDeSemanaChile } from './reporte-academico-ventana';
import {
  METRICAS_MANUALES, VALOR_ESTADO_CRITERIO, sanitizeCriterios,
  type ClaveCriterio, type GrupoCriterio,
} from './criterios-guia';
import { notaChilena, calcularAlertas, estadoFila, compararFilas, type Alerta, type CursoContexto } from './reglas-alertas-guia';

// ─── Datos crudos (lo que entrega la consulta) ────────────────────────────────

export interface BookingCrudo {
  dia: string | null;
  sm: string | null; sl: string | null; sm2: string | null; sl2: string | null;
  cerrada: boolean | null;
  asistio: boolean | null; asistencia: boolean | null; cancelo: boolean | null;
  noAprobo: boolean | null; escusa: boolean | null; rubrica: boolean | null;
  /**
   * La clase se cerró por la CARGA HISTÓRICA (`motivoCierre='CARGA_HISTORICA'`):
   * campañas cargadas después de dictadas. Cuenta para asistencia y lecciones (se
   * decidió "todos asistieron"), pero NO como evaluación dictada: los cuestionarios
   * aún no existían en la plataforma y nadie pudo rendirlos.
   */
  carga?: boolean | null;
  /** Los 9 criterios de la rúbrica, por clave de `METRICAS_MANUALES`. */
  crit: Partial<Record<ClaveCriterio, boolean | null>>;
}

export interface CasoCrudo { estado: string | null; abiertoEn: string | null }
export interface EvalCrudo { curso: string | null; code: string | null; step: string | null; cuestionarioId: string | null; porcentaje: number | null }
export interface NotaCriteriosCruda { salon: string | null; campaign: string | null; semanaInicio: string | null; criterios: any }
export interface NivelacionEntrada { resultado?: string; fecha?: string; fechaEvento?: string }

export interface AlumnoCrudo {
  peopleId: string;
  academicaId: string | null;
  numeroId: string | null;
  primerNombre: string | null; segundoNombre: string | null;
  primerApellido: string | null; segundoApellido: string | null;
  nivelacionHistory: NivelacionEntrada[] | null;
  nivelacionViva: boolean;
  bookings: BookingCrudo[];
  casos: CasoCrudo[];
  evals: EvalCrudo[];
  notas: NotaCriteriosCruda[];
}

export interface EventoCursoCrudo { dia: string | null; sm: string | null; sl: string | null; sm2: string | null; sl2: string | null; carga?: boolean | null }

export interface CursoCrudo {
  cursoId: string;
  campaign: string; tipoCurso: string; horarioCurso: string; salon: string | null;
  inicioCurso: string | null; finalCurso: string | null; inicioCampanaCursos: string | null;
  numeroUsuarios: number;
  /** Clases del curso ya ocurridas (todas, no sólo las de un alumno). */
  eventosPasados: EventoCursoCrudo[];
  /** Lecciones del programa (NIVELES), sin las de evaluación. */
  leccionesPrograma: number;
  /** Cuestionarios de cada lección de evaluación: clave `módulo||lección` → ids. */
  cuestionariosEval: Record<string, string[]>;
}

// ─── Métricas calculadas ──────────────────────────────────────────────────────

export interface FilaMetricas {
  asistencia: {
    presentes: number;
    faltas: number;
    /** Faltas justificadas: van aparte, no entran al porcentaje. */
    justificadas: number;
    /** Clases ya ocurridas cuya sesión el guía no cerró: no entran al porcentaje. */
    sinMarcar: number;
    /** presentes + faltas: el denominador del porcentaje. */
    sesiones: number;
    pct: number | null;
    faltasSeguidas: number;
    ultimaAsistencia: string | null;
  };
  lecciones: { vistas: number; dictadas: number; sinVer: number; totalPrograma: number };
  nivelaciones: { realizadas: number; ultima: string | null; enCurso: boolean };
  casos: { abiertos: number; total: number };
  evaluaciones: { dictadas: number; rendidas: number; pendientes: number; promedio: number | null; minima: number | null };
  criterios: Record<'H' | 'D' | 'A', number | null>;
}

export interface FilaResumenAlumno extends FilaMetricas {
  peopleId: string;
  academicaId: string | null;
  numeroId: string | null;
  primerNombre: string | null;
  primerApellido: string | null;
  /** "Apellido Apellido, Nombre Nombre" */
  nombre: string;
  alertas: Alerta[];
  estado: 'risk' | 'warn' | 'ok';
}

export interface ResumenCurso {
  alumnos: number;
  conAlertas: number;
  asistenciaMedia: number | null;
  sesionesDictadas: number;
  leccionesDictadas: number;
  leccionesPrograma: number;
  moduloActual: string | null;
  promedioEvaluaciones: number | null;
  evaluacionesDictadas: number;
  evaluacionesPendientes: number;
  casosAbiertos: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stripAccents = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normTexto = (s: any) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
export const claveLeccion = (modulo: any, leccion: any) => `${normTexto(modulo)}||${normTexto(leccion)}`;

/** La sesión de evaluación del módulo (legacy) o una lección de un módulo "Evaluación NN". */
export function esLeccionEvaluacion(modulo: any, leccion: any): boolean {
  return normTexto(leccion) === 'evaluacion' || normTexto(modulo).startsWith('evaluacion');
}

/** Lecciones (módulo, lección) que cubre una clase: una, o dos en los bloques de sábado. */
function slots(b: { sm: string | null; sl: string | null; sm2: string | null; sl2: string | null }) {
  const out: Array<{ modulo: string | null; leccion: string }> = [];
  if (b.sl) out.push({ modulo: b.sm, leccion: b.sl });
  if (b.sl2) out.push({ modulo: b.sm2, leccion: b.sl2 });
  return out;
}

const ms = (d: string | null) => (d ? new Date(d).getTime() : NaN);
const desde = (fecha: string | null | undefined, inicio: string | null) =>
  !inicio || (!!fecha && String(fecha).slice(0, 10) >= inicio);
const pctRedondo = (num: number, den: number) => (den > 0 ? Math.round((100 * num) / den) : null);

export const GRUPOS_CRITERIO: Record<'H' | 'D' | 'A', GrupoCriterio> = { H: 'HÁBITOS', D: 'DESEMPEÑO', A: 'ACTITUDES' };

// ─── Cálculo por alumno ───────────────────────────────────────────────────────

export function calcularMetricas(al: AlumnoCrudo, curso: CursoCrudo, now: Date = new Date()): FilaMetricas {
  const ahora = now.getTime();
  const inicio = curso.inicioCurso ? String(curso.inicioCurso).slice(0, 10) : null;
  const esImpulsa = normTexto(curso.tipoCurso) === 'impulsa';

  // Clases ya ocurridas y no canceladas, de la más antigua a la más reciente.
  const pasadas = al.bookings
    .filter(b => { const t = ms(b.dia); return !Number.isNaN(t) && t <= ahora && b.cancelo !== true; })
    .sort((a, b) => ms(a.dia) - ms(b.dia));

  // 1. Asistencia. Presente = el guía marcó asistencia. Si no, es justificada, sin
  //    marcar (la sesión no se cerró, así que el "no" aún no es un dato) o falta.
  type Marca = 'P' | 'F' | 'J' | 'SM';
  const marca = (b: BookingCrudo): Marca =>
    isExitosa(b) ? 'P' : b.escusa === true ? 'J' : b.cerrada !== true ? 'SM' : 'F';
  let presentes = 0, faltas = 0, justificadas = 0, sinMarcar = 0;
  let ultimaAsistencia: string | null = null;
  for (const b of pasadas) {
    const m = marca(b);
    if (m === 'P') { presentes++; ultimaAsistencia = b.dia; }
    else if (m === 'F') faltas++;
    else if (m === 'J') justificadas++;
    else sinMarcar++;
  }
  // Faltas seguidas: la racha MÁS RECIENTE. Las justificadas y las sin marcar no
  // suman ni la cortan; una asistencia sí la corta.
  let faltasSeguidas = 0;
  for (let i = pasadas.length - 1; i >= 0; i--) {
    const m = marca(pasadas[i]);
    if (m === 'P') break;
    if (m === 'F') faltasSeguidas++;
  }
  const sesiones = presentes + faltas;

  // 2. Lecciones (sin las de evaluación). Vista = la misma regla de «¿Cómo voy?»:
  //    asistió y no se marcó "No aprobó"; en IMPULSA la falta justificada también.
  const dictadas = new Set<string>();
  const vistas = new Set<string>();
  for (const b of pasadas) {
    const vista = (isExitosa(b) && b.noAprobo !== true) || (esImpulsa && b.escusa === true && b.noAprobo !== true);
    for (const s of slots(b)) {
      if (esLeccionEvaluacion(s.modulo, s.leccion)) continue;
      const k = claveLeccion(s.modulo, s.leccion);
      dictadas.add(k);
      if (vista) vistas.add(k);
    }
  }

  // 3. Nivelaciones realizadas en el período del curso.
  const nivs = (Array.isArray(al.nivelacionHistory) ? al.nivelacionHistory : [])
    .filter(h => String(h?.resultado || '').toUpperCase() === 'REALIZADA' && desde(h.fechaEvento || h.fecha, inicio));
  const ultimaNiv = nivs.map(h => h.fechaEvento || h.fecha || null).filter(Boolean).sort().pop() || null;

  // 4. Casos del período. Abierto = cualquier estado que no cierra (incluye los
  //    derivados a un área y "En proceso de cierre"); la regla es la del módulo.
  const casos = al.casos.filter(c => desde(c.abiertoEn, inicio));
  const abiertos = casos.filter(c => !cierraElCaso(c.estado)).length;

  // 5. Evaluaciones. Dictadas = cuestionarios de las lecciones de evaluación de
  //    las clases que el alumno ya tuvo (salvo las de la carga histórica, ver
  //    `BookingCrudo.carga`). Nota de cada cuestionario = su mejor intento, en
  //    escala chilena.
  const dictadasEval = new Set<string>(); // clave lección||cuestionario
  for (const b of pasadas) {
    if (b.carga === true) continue;
    for (const s of slots(b)) {
      const k = claveLeccion(s.modulo, s.leccion);
      for (const id of curso.cuestionariosEval[k] || []) dictadasEval.add(`${k}##${id}`);
    }
  }
  const mejor = new Map<string, number>();
  for (const e of al.evals) {
    if (normTexto(e.curso) !== normTexto(curso.tipoCurso)) continue;
    const k = claveLeccion(e.code, e.step);
    const ids = curso.cuestionariosEval[k];
    if (!ids || !ids.length) continue;
    // Filas viejas sin `cuestionarioId` = el primer cuestionario de la lección.
    const id = e.cuestionarioId || ids[0];
    const kk = `${k}##${id}`;
    const p = Number(e.porcentaje);
    if (!Number.isFinite(p)) continue;
    mejor.set(kk, Math.max(mejor.get(kk) ?? -1, p));
  }
  const notas = Array.from(mejor.values()).map(notaChilena);
  const rendidasDictadas = Array.from(mejor.keys()).filter(k => dictadasEval.has(k)).length;
  const promedio = notas.length ? Math.round((notas.reduce((a, n) => a + n, 0) / notas.length) * 10) / 10 : null;

  // 6. Criterios H/D/A. Por semana y criterio: si hay corrección manual en el
  //    Reporte Académico, manda (full=1, half=0,5, empty=0, con el peso de las
  //    sesiones evaluadas de esa semana); si no, cumplidas / evaluadas. Una
  //    sesión sin rúbrica evaluada es "no aplica" y no entra al denominador.
  const semanas = new Map<string, { evaluadas: number; cumplidas: Partial<Record<ClaveCriterio, number>>; manual: Record<string, string> }>();
  const semana = (k: string) => {
    if (!semanas.has(k)) semanas.set(k, { evaluadas: 0, cumplidas: {}, manual: {} });
    return semanas.get(k)!;
  };
  for (const b of pasadas) {
    if (!isExitosa(b) || b.rubrica !== true || !b.dia) continue;
    const s = semana(lunesDeSemanaChile(new Date(b.dia)));
    s.evaluadas++;
    for (const m of METRICAS_MANUALES) if (b.crit?.[m.key] === true) s.cumplidas[m.key] = (s.cumplidas[m.key] || 0) + 1;
  }
  for (const n of al.notas) {
    if (curso.salon && n.salon && n.salon !== curso.salon) continue;
    if (n.campaign && n.campaign !== curso.campaign) continue;
    const sem = n.semanaInicio ? String(n.semanaInicio).slice(0, 10) : null;
    if (!sem || !desde(sem, inicio)) continue;
    const c = sanitizeCriterios(n.criterios);
    if (Object.keys(c).length) Object.assign(semana(sem).manual, c);
  }
  const criterios = { H: null, D: null, A: null } as Record<'H' | 'D' | 'A', number | null>;
  for (const g of ['H', 'D', 'A'] as const) {
    let num = 0, den = 0;
    for (const m of METRICAS_MANUALES.filter(x => x.grupo === GRUPOS_CRITERIO[g])) {
      for (const s of Array.from(semanas.values())) {
        const man = s.manual[m.key] as keyof typeof VALOR_ESTADO_CRITERIO | undefined;
        if (man) {
          const w = Math.max(s.evaluadas, 1);
          num += VALOR_ESTADO_CRITERIO[man] * w; den += w;
        } else if (s.evaluadas > 0) {
          num += s.cumplidas[m.key] || 0; den += s.evaluadas;
        }
      }
    }
    criterios[g] = pctRedondo(num, den);
  }

  return {
    asistencia: {
      presentes, faltas, justificadas, sinMarcar, sesiones,
      pct: pctRedondo(presentes, sesiones),
      faltasSeguidas, ultimaAsistencia,
    },
    lecciones: {
      vistas: vistas.size, dictadas: dictadas.size,
      sinVer: Math.max(0, dictadas.size - vistas.size),
      totalPrograma: curso.leccionesPrograma,
    },
    nivelaciones: { realizadas: nivs.length, ultima: ultimaNiv, enCurso: al.nivelacionViva },
    casos: { abiertos, total: casos.length },
    evaluaciones: {
      dictadas: dictadasEval.size,
      rendidas: notas.length,
      pendientes: Math.max(0, dictadasEval.size - rendidasDictadas),
      promedio,
      minima: notas.length ? Math.min(...notas) : null,
    },
    criterios,
  };
}

export function nombreAlumno(al: Pick<AlumnoCrudo, 'primerNombre' | 'segundoNombre' | 'primerApellido' | 'segundoApellido'>): string {
  const ap = [al.primerApellido, al.segundoApellido].filter(Boolean).join(' ');
  const no = [al.primerNombre, al.segundoNombre].filter(Boolean).join(' ');
  return [ap, no].filter(Boolean).join(', ') || '(sin nombre)';
}

/** Filas del curso con sus alertas, ya ordenadas. */
export function construirFilas(alumnos: AlumnoCrudo[], curso: CursoCrudo, now: Date = new Date()): FilaResumenAlumno[] {
  const ctx: CursoContexto = { tipoCurso: curso.tipoCurso };
  return alumnos
    .map(al => {
      const m = calcularMetricas(al, curso, now);
      const alertas = calcularAlertas(m, ctx);
      return {
        ...m,
        peopleId: al.peopleId, academicaId: al.academicaId, numeroId: al.numeroId,
        primerNombre: al.primerNombre, primerApellido: al.primerApellido,
        nombre: nombreAlumno(al), alertas, estado: estadoFila(alertas),
      };
    })
    .sort(compararFilas);
}

/** Tarjetas de resumen del curso. */
export function resumirCurso(filas: FilaResumenAlumno[], curso: CursoCrudo): ResumenCurso {
  const eventos = curso.eventosPasados;
  const lecciones = new Set<string>();
  const cuestionarios = new Set<string>();
  for (const e of eventos) {
    for (const s of slots(e)) {
      const k = claveLeccion(s.modulo, s.leccion);
      if (!esLeccionEvaluacion(s.modulo, s.leccion)) lecciones.add(k);
      if (e.carga === true) continue;
      for (const id of curso.cuestionariosEval[k] || []) cuestionarios.add(`${k}##${id}`);
    }
  }
  const ultimo = eventos.length ? [...eventos].sort((a, b) => ms(a.dia) - ms(b.dia))[eventos.length - 1] : null;
  const pres = filas.reduce((a, f) => a + f.asistencia.presentes, 0);
  const ses = filas.reduce((a, f) => a + f.asistencia.sesiones, 0);
  const proms = filas.map(f => f.evaluaciones.promedio).filter((x): x is number => x !== null);
  return {
    alumnos: filas.length,
    conAlertas: filas.filter(f => f.alertas.length > 0).length,
    asistenciaMedia: pctRedondo(pres, ses),
    sesionesDictadas: eventos.length,
    leccionesDictadas: lecciones.size,
    leccionesPrograma: curso.leccionesPrograma,
    moduloActual: ultimo?.sm2 || ultimo?.sm || null,
    promedioEvaluaciones: proms.length ? Math.round((proms.reduce((a, n) => a + n, 0) / proms.length) * 10) / 10 : null,
    evaluacionesDictadas: cuestionarios.size,
    evaluacionesPendientes: filas.reduce((a, f) => a + f.evaluaciones.pendientes, 0),
    casosAbiertos: filas.reduce((a, f) => a + f.casos.abiertos, 0),
  };
}
