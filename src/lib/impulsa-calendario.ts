/**
 * Cálculo del calendario FIJO de un curso IMPULSA (cliente + servidor).
 *
 * IMPULSA no usa el motor dinámico de los cursos MOSAICO. Su calendario se
 * materializa UNA vez al crear el curso:
 *  - SESIONES: recurrencia L/M/V en [inicio, fin], 20:00–21:00 (60 min). En un día
 *    sin clase NO hay sesión, y esa clase se CORRE al final del curso para que el
 *    curso conserve su número de clases.
 *
 *    ⚠ Los días sin clase de IMPULSA son SÓLO los que el curso tiene cargados en
 *    su propio asistente. **No se aplica el calendario de festivos** —ni el legal
 *    de Chile ni los que Académico declara en Sesiones › Festivos, que rigen para
 *    los cursos MOSAICO—: IMPULSA dicta normal esos días salvo que su propia
 *    configuración diga lo contrario. Es una decisión operativa, no un descuido:
 *    IMPULSA es un curso intensivo con calendario cerrado desde que se crea.
 *  - ENTRENAMIENTOS: fechas fijas individuales, 2h30, default 09:30–12:00 (sáb),
 *    con override de fecha y hora por ocurrencia.
 *  - EVALUACIONES: fechas fijas individuales, 2h30, 18:30–21:00. Después de las sesiones.
 *  - COLISIÓN: si un entrenamiento/evaluación SE SOLAPA EN EL TIEMPO con la sesión
 *    L/M/V de ese día, el evento fijo gana y la sesión NO se genera (se registra).
 *
 * Zona de autoría: America/Santiago (hora local del curso). El instante UTC de cada
 * ocurrencia lo calcula PostgreSQL por fecha con la base IANA (DST-correcto) en la
 * materialización — aquí sólo se computan fechas/horas locales y el resumen.
 */
import { TZ_OPERACION } from './cursos-campaign';

export const IMPULSA_AUTHOR_TZ = TZ_OPERACION;
export const SESION_HORA_INICIO = '20:00';   // 20:00–21:00 (60 min)
export const SESION_DUR_MIN = 60;
// Entrenamiento (2h30): sábado 09:30–12:00; entre semana 18:30–21:00.
export const ENTREN_HORA_SABADO = '09:30';
export const ENTREN_HORA_SEMANA = '18:30';
export const EVAL_HORA_DEFAULT = '18:30';     // evaluaciones (entre semana) 18:30–21:00
export const LARGO_DUR_MIN = 150;             // entrenamientos + evaluaciones

/** Hora default de un ENTRENAMIENTO según el día: sábado→09:30, resto→18:30. */
export function defaultEntrenHora(fecha: string): string {
  return new Date(String(fecha).trim() + 'T00:00:00Z').getUTCDay() === 6
    ? ENTREN_HORA_SABADO : ENTREN_HORA_SEMANA;
}

export type ImpulsaTipo = 'SESSION' | 'ENTRENAMIENTO' | 'EVALUACION';

export interface FechaFija { fecha: string; horaInicio?: string }

export interface ImpulsaConfig {
  inicioSesiones: string;   // 'YYYY-MM-DD'
  finSesiones: string;      // 'YYYY-MM-DD'
  festivos: string[];       // ['YYYY-MM-DD', ...] (ingresados manualmente)
  entrenamientos: FechaFija[];
  evaluaciones: FechaFija[];
  authorTz?: string;
}

export interface EventoImpulsa {
  fecha: string; horaInicio: string; horaFin: string; tipo: ImpulsaTipo;
}

export interface ColisionImpulsa { fecha: string; sesion: string; evento: string }

export interface ResumenImpulsa {
  sesiones: number; entrenamientos: number; evaluaciones: number; total: number;
  horas: number; festivosOmitidos: string[]; colisiones: ColisionImpulsa[];
}

const asUTC = (s: string) => new Date(String(s).trim() + 'T00:00:00Z');
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const addMinHHMM = (hhmm: string, min: number) => {
  const t = toMin(hhmm) + min;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
// Solape de [aI,aF) con [bI,bF) en la MISMA fecha.
const overlap = (aI: string, aF: string, bI: string, bF: string) =>
  toMin(aI) < toMin(bF) && toMin(bI) < toMin(aF);

const normFijos = (arr: FechaFija[], defHora: (fecha: string) => string, tipo: ImpulsaTipo): EventoImpulsa[] =>
  (arr || [])
    .filter(e => e && String(e.fecha || '').trim())
    .map(e => {
      const fecha = String(e.fecha).trim();
      const hi = (e.horaInicio && e.horaInicio.trim()) || defHora(fecha);
      return { fecha, horaInicio: hi, horaFin: addMinHHMM(hi, LARGO_DUR_MIN), tipo };
    });

/**
 * Computa el calendario completo (sesiones + entrenamientos + evaluaciones) y el
 * resumen de validación (totales, horas, festivos omitidos, colisiones). Puro:
 * sin BD ni zona horaria (eso se resuelve al materializar).
 */
export function computeImpulsaCalendario(cfg: ImpulsaConfig) {
  const declarados = new Set((cfg.festivos || []).map(f => String(f).trim()).filter(Boolean));
  /**
   * Día sin clase: SÓLO los declarados en el asistente del propio curso. El
   * calendario de festivos (legal + declarados por Académico) no se consulta a
   * propósito — ver la nota de la cabecera.
   */
  const esFestivo = (fecha: string) => declarados.has(fecha);
  const entrenamientos = normFijos(cfg.entrenamientos, defaultEntrenHora, 'ENTRENAMIENTO');
  const evaluaciones = normFijos(cfg.evaluaciones, () => EVAL_HORA_DEFAULT, 'EVALUACION');
  const fijos = [...entrenamientos, ...evaluaciones];

  const sesiones: EventoImpulsa[] = [];
  const festivosOmitidos: string[] = [];
  const colisiones: ColisionImpulsa[] = [];
  const sI = SESION_HORA_INICIO, sF = addMinHHMM(SESION_HORA_INICIO, SESION_DUR_MIN);

  const start = asUTC(cfg.inicioSesiones), end = asUTC(cfg.finSesiones);
  const esDiaClase = (t: Date) => { const wd = t.getUTCDay(); return wd === 1 || wd === 3 || wd === 5; };

  /**
   * Cuántas sesiones debe tener el curso: todos los L-M-V de la ventana MENOS los
   * que ocupa un entrenamiento o una evaluación (ahí el evento fijo reemplaza a la
   * clase). Los festivos NO se descuentan: esa clase se corre al final, igual que
   * en los cursos de MOSAICO — el curso conserva su número de clases.
   */
  let objetivo = 0;
  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    if (!esDiaClase(t)) continue;
    const fecha = t.toISOString().slice(0, 10);
    if (fijos.some(f => f.fecha === fecha && overlap(sI, sF, f.horaInicio, f.horaFin))) continue;
    objetivo++;
  }

  /** Agenda la sesión de ese día, o explica por qué no. */
  const intentar = (fecha: string): boolean => {
    if (esFestivo(fecha)) { festivosOmitidos.push(fecha); return false; }
    const choque = fijos.find(f => f.fecha === fecha && overlap(sI, sF, f.horaInicio, f.horaFin));
    if (choque) {
      colisiones.push({ fecha, sesion: `${sI}–${sF}`, evento: `${choque.tipo} ${choque.horaInicio}–${choque.horaFin}` });
      return false;
    }
    sesiones.push({ fecha, horaInicio: sI, horaFin: sF, tipo: 'SESSION' });
    return true;
  };

  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    if (esDiaClase(t)) intentar(t.toISOString().slice(0, 10));
  }

  // Las clases que cayeron en festivo se corren DESPUÉS del fin de la ventana,
  // hasta completar el número de sesiones. El tope evita que un curso mal
  // configurado (todo festivo) se extienda sin fin.
  const t = new Date(end);
  for (let guard = 0; sesiones.length < objetivo && guard < 400; guard++) {
    t.setUTCDate(t.getUTCDate() + 1);
    if (esDiaClase(t)) intentar(t.toISOString().slice(0, 10));
  }
  sesiones.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const horas = sesiones.length * (SESION_DUR_MIN / 60)
    + (entrenamientos.length + evaluaciones.length) * (LARGO_DUR_MIN / 60);
  const resumen: ResumenImpulsa = {
    sesiones: sesiones.length,
    entrenamientos: entrenamientos.length,
    evaluaciones: evaluaciones.length,
    total: sesiones.length + entrenamientos.length + evaluaciones.length,
    horas: Math.round(horas * 100) / 100,
    festivosOmitidos,
    colisiones,
  };
  return { sesiones, entrenamientos, evaluaciones, resumen, authorTz: cfg.authorTz || IMPULSA_AUTHOR_TZ };
}
