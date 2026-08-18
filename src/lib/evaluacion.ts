/**
 * Qué sesión es una EVALUACIÓN (cliente + servidor).
 *
 * En MOSAICO el currículo lo declara todo en `NIVELES`: las evaluaciones y los
 * entrenamientos son MÓDULOS propios (`Evaluacion 01`, `Entrenamiento 02`), con su
 * propia lección y su contenido. No es regla que tras cada módulo venga una
 * evaluación — cada curso declara las suyas y dónde van.
 *
 * Antes el mapeo de sesiones INVENTABA una evaluación al cierre de cada módulo
 * (9 en DANSHI, 30 en KODOMO…), y encima se la ponía a los propios módulos de
 * evaluación. Esas sesiones sintéticas sobreviven en los salones que ya las
 * dictaron (ver `CURSOS_CAMPAIGN."evalSinteticaPorModulo"`), así que la detección
 * acepta las dos formas: el módulo declarado y la etiqueta legacy.
 */

/** Etiqueta de lección con que se marcaban las evaluaciones SINTÉTICAS (legacy). */
export const EVALUACION_STEP = 'Evaluación';

const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** El módulo ES una evaluación declarada en NIVELES (`Evaluacion 01`, `Evaluación 03`…). */
export function esModuloEvaluacion(code: unknown): boolean {
  return /evaluac/.test(norm(code));
}

/** El módulo ES un entrenamiento declarado en NIVELES (`Entrenamiento 01`…). */
export function esModuloEntrenamiento(code: unknown): boolean {
  return /entren/.test(norm(code));
}

/**
 * La sesión es una evaluación: porque su módulo lo es (currículo), o porque lleva
 * la etiqueta sintética legacy (salones que ya la dictaron).
 */
export function esSesionEvaluacion(sesionModulo: unknown, sesionLeccion: unknown): boolean {
  return esModuloEvaluacion(sesionModulo) || norm(sesionLeccion) === norm(EVALUACION_STEP);
}
