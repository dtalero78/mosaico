/**
 * Cuándo puede el Guía gestionar el Reporte Académico.
 *
 * La semana de clases va de lunes a domingo, pero el Guía **sólo trabaja el
 * informe de MIÉRCOLES a DOMINGO**: para el miércoles ya se dictaron las clases
 * de la semana (los cursos se reúnen LUN-MIÉ, MAR-JUE o SÁB), así que antes de
 * ese día no hay nada que valorar. Lunes y martes lo ve en sólo lectura.
 *
 * El día se mira en **hora de Chile**, no en la del servidor ni en la del
 * navegador: si no, un guía en otro huso —o el propio servidor, que corre en
 * UTC— vería la ventana abrirse o cerrarse a destiempo. En UTC el domingo se
 * acaba a las 20:00 de Chile, y le comería la última tarde.
 *
 * Cliente + servidor (sin `server-only`): la pantalla decide con esto qué
 * mostrar en sólo lectura, y el servidor vuelve a comprobarlo antes de escribir.
 * La UI no es la barrera.
 */
import { ahoraEnChile } from './cursos-campaign';

/** Días en que el Guía puede gestionar: miércoles(3) a domingo(0). */
export const DIAS_GESTION_GUIA = [3, 4, 5, 6, 0];

/** Día de la semana en Chile (0=domingo … 6=sábado). */
export function diaSemanaChile(now: Date = new Date()): number {
  const [y, m, d] = ahoraEnChile(now).slice(0, 10).split('-').map(Number);
  // Se arma en UTC a propósito: sólo interesa el día del calendario ya resuelto
  // a hora de Chile, y así el huso del proceso no vuelve a entrar en juego.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** La fecha de hoy en Chile, `YYYY-MM-DD`. */
export function hoyEnChile(now: Date = new Date()): string {
  return ahoraEnChile(now).slice(0, 10);
}

/** ¿Está el Guía dentro de su ventana (miércoles a domingo, hora de Chile)? */
export function guiaEnVentana(now: Date = new Date()): boolean {
  return DIAS_GESTION_GUIA.includes(diaSemanaChile(now));
}

/** Lunes de la semana EN CURSO en Chile, `YYYY-MM-DD` (la llave `semanaInicio`). */
export function lunesDeSemanaChile(now: Date = new Date()): string {
  const [y, m, d] = hoyEnChile(now).split('-').map(Number);
  const hoy = new Date(Date.UTC(y, m - 1, d));
  hoy.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7));
  return hoy.toISOString().slice(0, 10);
}

/** ¿Esa semana (por su lunes) ya terminó? Anterior a la semana en curso, en Chile. */
export function esSemanaPasada(semanaInicio: string | null | undefined, now: Date = new Date()): boolean {
  const s = String(semanaInicio || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s < lunesDeSemanaChile(now);
}

/**
 * ¿Puede el Guía gestionar el informe de esa semana AHORA?
 *
 * - **Semana en curso**: sólo de miércoles a domingo (hasta el miércoles no se han
 *   dictado sus clases; nada que valorar).
 * - **Semana ya terminada** (la que le quedó pendiente y ve en Procesos sin
 *   gestión): cualquier día. La ventana existe por las clases de la semana, y
 *   en una semana cerrada ya se dictaron todas — decisión del usuario (sep-2026).
 *
 * Sin semana (llamadas viejas) se conserva la regla de la semana en curso.
 */
export function guiaPuedeGestionar(semanaInicio?: string | null, now: Date = new Date()): boolean {
  if (esSemanaPasada(semanaInicio, now)) return true;
  return guiaEnVentana(now);
}

export const MENSAJE_FUERA_DE_VENTANA =
  'El informe de la semana en curso se gestiona de miércoles a domingo. Lunes y martes queda en solo lectura.';
