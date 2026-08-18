/**
 * Reglas y helpers para eventos compartidos ENTRE CURSOS.
 *
 * Un evento compartido es UNA clase real del guía que se replica en 2-3 filas
 * de CALENDARIO —una por curso— para que los alumnos de cada curso la vean y la
 * agenden desde su propio panel. Todas las filas comparten un
 * `eventoCompartidoId` (UUID), y por eso los KPIs del guía la cuentan como
 * **1 sola hora** (ver advisor-event-log.service).
 *
 * Cada hermano lleva su propia **campaña, curso, salón, módulo y lección**;
 * comparten guía, fecha/hora, tipo, link de Zoom y límite de usuarios.
 *
 * COMPARTIBILIDAD (MOSAICO): cualquier tipo de evento se puede compartir.
 * La restricción anterior —sólo Jumps (Steps 5,10…45) y MASTER (Step 46)— era
 * del motor de Steps de LGS, que MOSAICO no usa: dejaba la casilla inservible.
 *
 * OJO — esto NO es lo mismo que la colisión de guía de CURSOS_CAMPAIGN
 * (colision-guia.service): allí se impide que un guía tenga dos CURSOS de
 * campaña a la misma hora. Aquí se trata de eventos puntuales del calendario,
 * y el chequeo de solape del guía excluye a los hermanos del propio grupo.
 *
 * Helpers sin `server-only` para reutilizar en frontend y backend.
 */

/** Máximo de filas de un grupo compartido: 1 padre + 2 hijos. */
export const MAX_CURSOS_COMPARTIDOS = 3;

/** Extrae el número del step ("Step 5" → 5; "TRAINING - Step 10" → 10). */
export { extractStepNumber } from './motor-academico';

/**
 * Extrae el prefijo del tipo de club de un step ("KARAOKE - Step 16" → "KARAOKE").
 * Para SESSION o steps sin prefijo devuelve null. Se sigue usando para filtrar
 * las opciones de club en el modal.
 */
export function extractClubPrefix(step: string | null | undefined): string | null {
  if (!step) return null;
  const m = String(step).trim().match(/^([A-ZÁÉÍÓÚÑ]+)\s*-/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  if (prefix === 'STEP') return null;   // "Step 5" no es un prefijo de club
  return prefix;
}

/**
 * Identidad de un hermano del grupo: campaña + curso + salón. Dos hermanos no
 * pueden tener la misma — sería el mismo destino dos veces.
 */
export function claveCursoCompartido(c: {
  campaign?: string | null; curso?: string | null; salon?: string | null;
}): string {
  const n = (s?: string | null) => String(s || '').trim().toUpperCase();
  return `${n(c.campaign)}|${n(c.curso)}|${n(c.salon)}`;
}
