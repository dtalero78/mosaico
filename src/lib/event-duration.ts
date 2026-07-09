/**
 * Duración de eventos de CALENDARIO.
 *
 * MOSAICO no persiste la duración de los eventos: se DERIVA del `tipo`.
 * Todos los eventos duran 60 minutos EXCEPTO los de tipo `NIVELACION`,
 * que duran 30 minutos. Este helper es la única fuente de verdad para
 * calcular la hora de fin / duración en render (rango inicio–fin) y en
 * los chequeos de solape (admin-events).
 *
 * Client + server safe (sin 'server-only'): lo usan tanto los componentes
 * del calendario como los repositorios/servicios.
 */
import { format } from 'date-fns';

export const NIVELACION_DURATION_MIN = 30;
export const DEFAULT_EVENT_DURATION_MIN = 60;

/** Minutos de duración de un evento según su tipo. NIVELACION → 30, resto → 60. */
export function eventDurationMin(tipo?: string | null): number {
  return String(tipo || '').toUpperCase() === 'NIVELACION'
    ? NIVELACION_DURATION_MIN
    : DEFAULT_EVENT_DURATION_MIN;
}

/** Fecha/hora de fin del evento (inicio + duración según tipo). */
export function eventEndDate(dia: Date | string, tipo?: string | null): Date {
  const start = typeof dia === 'string' ? new Date(dia) : dia;
  return new Date(start.getTime() + eventDurationMin(tipo) * 60_000);
}

/**
 * Rango "HH:mm – HH:mm" (inicio – fin) en la hora LOCAL del navegador.
 * `fmt` permite otro patrón de date-fns (default 'HH:mm', 24h).
 */
export function formatEventTimeRange(
  dia: Date | string,
  tipo?: string | null,
  fmt: string = 'HH:mm',
): string {
  const start = typeof dia === 'string' ? new Date(dia) : dia;
  return `${format(start, fmt)} – ${format(eventEndDate(dia, tipo), fmt)}`;
}
