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

/**
 * Horas antes del evento hasta las que el alumno puede confirmar.
 *
 * El plazo se cuenta desde el HORARIO ASIGNADO, no desde una fecha fija del
 * calendario. Antes era el jueves 09:00 de la semana de la solicitud, y eso
 * dejaba fuera el caso normal: una nivelación pedida el miércoles y agendada
 * para el viernes le vencía el jueves por la mañana, con el evento todavía a
 * un día de distancia. El alumno veía "el plazo venció" con 20 horas por
 * delante. Contarlo desde el evento es lo que el panel le promete.
 */
export const HORAS_ANTES_CONFIRMACION = 3;
/** Hora (Chile) en que el sistema cancela lo que nadie confirmó. */
export const HORA_CANCELACION = 22;

/**
 * Horas en que se puede pedir una nivelación: de 17:00 a 20:30, cada media hora.
 *
 * Es un catálogo cerrado y no un campo libre porque la hora la teclearía cada
 * guía a su manera ('5 pm', '17hrs') y Servicio no podría agrupar por ella. Vive
 * aquí para que el desplegable del panel del guía, el del alta de Servicio y la
 * validación del servidor usen la MISMA lista.
 */
export const HORAS_NIVELACION: string[] = (() => {
  const out: string[] = [];
  for (let m = 17 * 60; m <= 20 * 60 + 30; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
})();

export function esHoraNivelacionValida(h: unknown): h is string {
  return typeof h === 'string' && HORAS_NIVELACION.includes(h);
}

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
 *  - `vencida`: quedan menos de HORAS_ANTES_CONFIRMACION para el evento; sólo
 *    Servicio puede confirmarla a mano.
 *
 * SIN evento asignado la confirmación queda `abierta`: el alumno no tiene qué
 * confirmar todavía y el panel le oculta el botón, pero decir "venció" sería
 * falso — no ha tenido oportunidad. El plazo empieza a correr cuando Servicio
 * agrupa la nivelación y le asigna horario.
 */
export function estadoConfirmacion(
  det: DetalleNivelacion | null | undefined,
  now: Date = new Date(),
  fechaEvento?: any,
): EstadoConfirmacion {
  if (!det?.fecha) return 'sin-solicitud';
  if (det.confirmadoEn) return 'confirmada';
  if (!fechaEvento) return 'abierta';
  const ev = fechaEvento instanceof Date ? fechaEvento : new Date(fechaEvento);
  if (isNaN(ev.getTime())) return 'abierta';
  const horas = (ev.getTime() - now.getTime()) / 3_600_000;
  return horas > HORAS_ANTES_CONFIRMACION ? 'abierta' : 'vencida';
}

/** ¿Puede el ALUMNO confirmar ahora mismo? Servicio no pasa por aquí. */
export function puedeConfirmarAlumno(
  det: DetalleNivelacion | null | undefined,
  now: Date = new Date(),
  fechaEvento?: any,
): boolean {
  return estadoConfirmacion(det, now, fechaEvento) === 'abierta';
}

/** ¿Ya se debe cancelar por falta de confirmación? (jueves 22:00 cumplido) */
export function debeCancelarse(det: DetalleNivelacion | null | undefined, now: Date = new Date()): boolean {
  if (!det?.fecha || det.confirmadoEn) return false;
  const corte = corteCancelacion(det.fecha);
  return !!corte && ahoraEnChile(now) >= corte;
}

export const MENSAJE_CONFIRMACION_VENCIDA =
  `El plazo para confirmar venció (menos de ${HORAS_ANTES_CONFIRMACION} horas para la nivelación). Comunícate con el Área de Servicio.`;
