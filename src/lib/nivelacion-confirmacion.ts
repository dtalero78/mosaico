/**
 * Confirmación de la nivelación por parte del usuario.
 * ────────────────────────────────────────────────────────────────────────────
 * Cuando el guía pide una nivelación, el alumno tiene que confirmar que va a
 * asistir. El ciclo es semanal y se ancla al JUEVES:
 *
 *   solicitud ──► el alumno puede confirmar ──► jueves 09:00 ──► sólo Servicio
 *                                                                 puede confirmar
 *                                             ──► jueves 22:00 ──► el sistema
 *                                                                 la cancela
 *
 * Las dos horas son distintas a propósito: a las 09:00 se le cierra la puerta al
 * alumno para que Servicio tenga la mañana de trabajar el listado, y a las 22:00
 * se limpia lo que nadie confirmó.
 *
 * Todo se mide en **hora de Chile** y no en la del navegador: si se comparara
 * contra un `new Date()` local, en Colombia el corte caería a las 08:00 chilenas
 * y un alumno tendría una hora menos que otro por estar en otro país.
 *
 * El helper es puro y vive fuera de `server-only` porque la MISMA regla decide
 * si se pinta el botón en el panel del alumno y si el servidor acepta la
 * confirmación — ocultar el botón no es una validación.
 */
import { TZ_OPERACION, ahoraEnChile } from './cursos-campaign';

export { TZ_OPERACION };

/** Jueves. `Date.getUTCDay()`: 0 = domingo. */
export const DIA_CORTE = 4;
/** Hora (Chile) en que el alumno deja de poder confirmar. */
export const HORA_CIERRE_CONFIRMACION = 9;
/** Hora (Chile) en que el sistema cancela lo que nadie confirmó. */
export const HORA_CANCELACION = 22;

export type QuienConfirma = 'ESTUDIANTE' | 'SERVICIO';

/** Lo que guarda `ACADEMICA.detalleNivelacion`. */
export interface DetalleNivelacion {
  leccion?: string | null;
  modulo?: string | null;
  /** Instante en que el guía la pidió (ISO). */
  fecha?: string | null;
  marcadoPor?: string | null;
  registradoPor?: string | null;
  registradoPorEmail?: string | null;
  /** Instante en que se confirmó (ISO). Ausente = sin confirmar. */
  confirmadoEn?: string | null;
  confirmadoPor?: QuienConfirma | null;
  confirmadoPorNombre?: string | null;
}

/** Suma días a una fecha `YYYY-MM-DD` en UTC (el huso del proceso no interviene). */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Día de la semana (0=domingo) de una fecha `YYYY-MM-DD`. */
function diaSemana(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Un instante (Date | ISO) como `'YYYY-MM-DDTHH:mm'` de Chile, comparable como
 * string. Se formatea en vez de operar con `Date` por la razón del encabezado.
 */
export function enChile(v: any): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return ahoraEnChile(d);
}

/**
 * Fecha del jueves del corte: el **primer jueves estrictamente posterior** al
 * instante de la solicitud, mirando las 09:00.
 *
 * Se compara contra las 09:00 y no contra el día suelto para que una solicitud
 * hecha el jueves por la mañana no cierre en el instante siguiente: si el guía
 * la pide un jueves a las 08:00 el corte es esa misma mañana (una hora), y si la
 * pide a las 10:00 pasa al jueves siguiente. Es la lectura literal de "el
 * próximo jueves": el ciclo de esa semana ya se cerró.
 */
function jueveDelCorte(fechaSolicitud: any): string {
  const s = enChile(fechaSolicitud);
  if (!s) return '';
  const dia = s.slice(0, 10);
  let jueves = sumarDias(dia, (DIA_CORTE - diaSemana(dia) + 7) % 7);
  const hh = String(HORA_CIERRE_CONFIRMACION).padStart(2, '0');
  if (`${jueves}T${hh}:00` <= s) jueves = sumarDias(jueves, 7);
  return jueves;
}

/** Hasta cuándo puede confirmar el ALUMNO: `'YYYY-MM-DDTHH:mm'` de Chile. */
export function corteConfirmacion(fechaSolicitud: any): string {
  const j = jueveDelCorte(fechaSolicitud);
  return j ? `${j}T${String(HORA_CIERRE_CONFIRMACION).padStart(2, '0')}:00` : '';
}

/** Cuándo el sistema cancela la que nadie confirmó: `'YYYY-MM-DDTHH:mm'` de Chile. */
export function corteCancelacion(fechaSolicitud: any): string {
  const j = jueveDelCorte(fechaSolicitud);
  return j ? `${j}T${String(HORA_CANCELACION).padStart(2, '0')}:00` : '';
}

export type EstadoConfirmacion = 'sin-solicitud' | 'confirmada' | 'abierta' | 'vencida';

/**
 * En qué punto del ciclo está la confirmación.
 *  - `confirmada`: alguien ya la confirmó (el alumno o Servicio).
 *  - `abierta`: el alumno todavía puede confirmarla.
 *  - `vencida`: pasaron las 09:00 del jueves; sólo Servicio puede.
 */
export function estadoConfirmacion(det: DetalleNivelacion | null | undefined, now: Date = new Date()): EstadoConfirmacion {
  if (!det?.fecha) return 'sin-solicitud';
  if (det.confirmadoEn) return 'confirmada';
  const corte = corteConfirmacion(det.fecha);
  return corte && ahoraEnChile(now) < corte ? 'abierta' : 'vencida';
}

/** ¿Puede el ALUMNO confirmar ahora mismo? Servicio no pasa por aquí. */
export function puedeConfirmarAlumno(det: DetalleNivelacion | null | undefined, now: Date = new Date()): boolean {
  return estadoConfirmacion(det, now) === 'abierta';
}

/** ¿Ya se debe cancelar por falta de confirmación? (jueves 22:00 cumplido) */
export function debeCancelarse(det: DetalleNivelacion | null | undefined, now: Date = new Date()): boolean {
  if (!det?.fecha || det.confirmadoEn) return false;
  const corte = corteCancelacion(det.fecha);
  return !!corte && ahoraEnChile(now) >= corte;
}

export const MENSAJE_CONFIRMACION_VENCIDA =
  'El plazo para confirmar venció (jueves 09:00). Comunícate con el Área de Servicio.';
