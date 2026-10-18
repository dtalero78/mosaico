/**
 * Panel del guía — reglas de alertas, colores y orden (cliente + servidor).
 *
 * TODO umbral vive aquí: el servicio entrega métricas crudas y esta función pura
 * decide qué es una alerta, de qué severidad y en qué orden se muestra. Ni el SQL
 * ni la pantalla repiten un número: si cambia un umbral, cambia en un solo sitio.
 */
import type { FilaMetricas } from './resumen-guia';

export type Severidad = 'risk' | 'warn';
export type Tono = 'risk' | 'warn' | 'ok' | 'none';

export interface Alerta {
  codigo: 'ASISTENCIA_BAJA' | 'FALTAS_SEGUIDAS' | 'CASO_ABIERTO' | 'PROMEDIO_BAJO' | 'EVALUACION_PENDIENTE' | 'LECCIONES_SIN_VER';
  severidad: Severidad;
  /** Lo que se ve en la etiqueta, corto como en el diseño ("Ausente ×3"). */
  etiqueta: string;
  /** La explicación con la cifra: texto al pasar el mouse y columna del CSV. */
  detalle: string;
}

/** Contexto del curso que pueden necesitar las reglas. */
export interface CursoContexto {
  tipoCurso: string;
}

export const UMBRALES = {
  /** % de asistencia bajo el cual es alerta roja (y color rojo). */
  asistenciaRiesgo: 75,
  /** % de asistencia bajo el cual el color es ámbar. */
  asistenciaAviso: 85,
  /** Faltas seguidas (las más recientes) desde las que es alerta roja. */
  faltasSeguidas: 2,
  /** Nota (escala 1,0–7,0) bajo la cual es alerta roja y color rojo. */
  notaRiesgo: 4.0,
  /** Nota bajo la cual el color es ámbar. */
  notaAviso: 5.0,
  /** Lecciones dictadas sin ver desde las que es alerta ámbar. */
  leccionesSinVer: 3,
  /** % de criterios bajo el cual el color es rojo / ámbar. */
  criterioRiesgo: 60,
  criterioAviso: 75,
} as const;

/**
 * Exigencia de la escala chilena: con el 60% del puntaje se obtiene un 4,0.
 * Es la misma barra con la que el cuestionario se da por aprobado (≥60%).
 */
export const EXIGENCIA_NOTA = 60;

/**
 * Porcentaje (0–100) → nota chilena 1,0–7,0 con exigencia del 60%:
 * de 0 a 60% la nota sube de 1,0 a 4,0, y de 60 a 100% de 4,0 a 7,0.
 * Se redondea a un decimal, pero bajo la exigencia nunca llega a 4,0: un 59%
 * daría 3,95 → 4,0, y el cuestionario está REPROBADO; mostrarle un 4,0 (nota de
 * aprobado, sin alerta) diría lo contrario de lo que pasó.
 */
export function notaChilena(porcentaje: number): number {
  const p = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  if (p < EXIGENCIA_NOTA) return Math.min(3.9, Math.round((1 + (3 * p) / EXIGENCIA_NOTA) * 10) / 10);
  return Math.round((4 + (3 * (p - EXIGENCIA_NOTA)) / (100 - EXIGENCIA_NOTA)) * 10) / 10;
}

/** "4,5" — coma decimal, un decimal. */
export const formatoNota = (n: number) => n.toFixed(1).replace('.', ',');

export function tonoAsistencia(pct: number | null): Tono {
  if (pct === null) return 'none';
  if (pct < UMBRALES.asistenciaRiesgo) return 'risk';
  if (pct < UMBRALES.asistenciaAviso) return 'warn';
  return 'ok';
}

export function tonoNota(nota: number | null): Tono {
  if (nota === null) return 'none';
  if (nota < UMBRALES.notaRiesgo) return 'risk';
  if (nota < UMBRALES.notaAviso) return 'warn';
  return 'ok';
}

export function tonoCriterio(pct: number | null): Tono {
  if (pct === null) return 'none';
  if (pct < UMBRALES.criterioRiesgo) return 'risk';
  if (pct < UMBRALES.criterioAviso) return 'warn';
  return 'ok';
}

/**
 * Las alertas de un alumno, rojas primero y en el orden de las reglas.
 * Una métrica sin datos (null) nunca genera alerta: no se alarma por lo que
 * todavía no se puede medir.
 */
export function calcularAlertas(f: FilaMetricas, _curso?: CursoContexto): Alerta[] {
  const out: Alerta[] = [];
  const a = f.asistencia;
  if (a.pct !== null && a.pct < UMBRALES.asistenciaRiesgo) {
    out.push({ codigo: 'ASISTENCIA_BAJA', severidad: 'risk', etiqueta: 'Asistencia',
      detalle: `Asistencia ${a.pct}% (menos de ${UMBRALES.asistenciaRiesgo}%)` });
  }
  if (a.faltasSeguidas >= UMBRALES.faltasSeguidas) {
    out.push({ codigo: 'FALTAS_SEGUIDAS', severidad: 'risk', etiqueta: `Ausente ×${a.faltasSeguidas}`,
      detalle: `${a.faltasSeguidas} faltas seguidas` });
  }
  if (f.casos.abiertos > 0) {
    out.push({ codigo: 'CASO_ABIERTO', severidad: 'risk', etiqueta: 'Caso abierto',
      detalle: f.casos.abiertos === 1 ? '1 caso de atención abierto' : `${f.casos.abiertos} casos de atención abiertos` });
  }
  const e = f.evaluaciones;
  if (e.promedio !== null && e.promedio < UMBRALES.notaRiesgo) {
    out.push({ codigo: 'PROMEDIO_BAJO', severidad: 'risk', etiqueta: 'Nota',
      detalle: `Promedio ${formatoNota(e.promedio)} (menos de ${formatoNota(UMBRALES.notaRiesgo)})` });
  }
  if (e.pendientes > 0) {
    out.push({ codigo: 'EVALUACION_PENDIENTE', severidad: 'warn', etiqueta: 'Eval. pendiente',
      detalle: e.pendientes === 1 ? '1 evaluación dictada sin rendir' : `${e.pendientes} evaluaciones dictadas sin rendir` });
  }
  if (f.lecciones.sinVer >= UMBRALES.leccionesSinVer) {
    out.push({ codigo: 'LECCIONES_SIN_VER', severidad: 'warn', etiqueta: 'Requiere nivelación',
      detalle: `${f.lecciones.sinVer} lecciones dictadas sin ver` });
  }
  // Estable: las rojas primero, conservando el orden de las reglas dentro de cada grupo.
  return [...out.filter(x => x.severidad === 'risk'), ...out.filter(x => x.severidad === 'warn')];
}

/** Estado del punto de la fila: la peor alerta. */
export function estadoFila(alertas: Alerta[]): 'risk' | 'warn' | 'ok' {
  if (alertas.some(a => a.severidad === 'risk')) return 'risk';
  if (alertas.length) return 'warn';
  return 'ok';
}

/** Orden: con alertas primero, luego más rojas, luego más alertas, luego apellido y nombre. */
export function compararFilas(
  a: { alertas: Alerta[]; primerApellido: string | null; primerNombre: string | null },
  b: { alertas: Alerta[]; primerApellido: string | null; primerNombre: string | null },
): number {
  const conA = a.alertas.length > 0 ? 1 : 0;
  const conB = b.alertas.length > 0 ? 1 : 0;
  if (conA !== conB) return conB - conA;
  const rojas = (x: typeof a) => x.alertas.filter(al => al.severidad === 'risk').length;
  if (rojas(a) !== rojas(b)) return rojas(b) - rojas(a);
  if (a.alertas.length !== b.alertas.length) return b.alertas.length - a.alertas.length;
  const cmp = (x: string | null, y: string | null) =>
    String(x || '').localeCompare(String(y || ''), 'es', { sensitivity: 'base' });
  return cmp(a.primerApellido, b.primerApellido) || cmp(a.primerNombre, b.primerNombre);
}
