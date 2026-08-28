/**
 * Duración de eventos de CALENDARIO.
 *
 * La duración sale del HORARIO del curso, que el evento guarda en
 * `nombreEvento` ("LUN-MIÉ 19:15-20:05" → 50 min). Se lee con
 * `parseHorarioRango`, el mismo parser con el que se generaron los eventos, así
 * que la hora de fin que se pinta es la que declara el curso.
 *
 * Por encima de todo manda `duracionMin` del propio evento, cuando lo tiene:
 * una nivelación dura 30 minutos pero se puede ampliar a una hora, y eso es una
 * decisión de quien la agenda, no una propiedad del tipo.
 *
 * Sin horario legible se cae al `tipo`: NIVELACION 30, ENTRENAMIENTO/EVALUACION
 * (IMPULSA) 150, el resto 60. Antes ESA era la única fuente, y como asumía 60 min
 * para toda sesión, pintaba mal el fin de los cursos que no duran una hora — las
 * clases de 50 min salían 10 minutos largas y las de sábado (2 h), una hora cortas.
 *
 * Este helper es la única fuente de verdad para la hora de fin / duración, tanto
 * en render (rango inicio–fin) como en los chequeos de solape.
 *
 * Client + server safe (sin 'server-only'): lo usan tanto los componentes
 * del calendario como los repositorios/servicios.
 */
import { format } from 'date-fns';
import { parseHorarioRango } from './cursos-campaign';

export const NIVELACION_DURATION_MIN = 30;
export const DEFAULT_EVENT_DURATION_MIN = 60;
// IMPULSA: entrenamientos y evaluaciones duran 2h30 (150 min).
export const IMPULSA_LARGO_DURATION_MIN = 150;

const DURATION_BY_TIPO: Record<string, number> = {
  NIVELACION: NIVELACION_DURATION_MIN,
  ENTRENAMIENTO: IMPULSA_LARGO_DURATION_MIN,
  EVALUACION: IMPULSA_LARGO_DURATION_MIN,
};

/**
 * Minutos que dura el evento. Manda el `horario` del curso si es legible
 * ("MAR-JUE 19:00-19:50" → 50); si no, el `tipo`.
 */
export function eventDurationMin(
  tipo?: string | null,
  horario?: string | null,
  duracionMin?: number | null,
): number {
  // Duración propia del evento: gana sobre el horario y sobre el tipo.
  const propia = Number(duracionMin);
  if (Number.isFinite(propia) && propia > 0) return propia;
  const rango = horario ? parseHorarioRango(horario) : null;
  if (rango) return rango.finMin - rango.inicioMin;
  return DURATION_BY_TIPO[String(tipo || '').toUpperCase()] ?? DEFAULT_EVENT_DURATION_MIN;
}

/** Fecha/hora de fin del evento (inicio + su duración). */
export function eventEndDate(
  dia: Date | string,
  tipo?: string | null,
  horario?: string | null,
  duracionMin?: number | null,
): Date {
  const start = typeof dia === 'string' ? new Date(dia) : dia;
  return new Date(start.getTime() + eventDurationMin(tipo, horario, duracionMin) * 60_000);
}

/**
 * Rango "HH:mm – HH:mm" (inicio – fin) en la hora LOCAL del navegador.
 * `fmt` permite otro patrón de date-fns (default 'HH:mm', 24h).
 */
export function formatEventTimeRange(
  dia: Date | string,
  tipo?: string | null,
  horario?: string | null,
  duracionMin?: number | null,
  fmt: string = 'HH:mm',
): string {
  const start = typeof dia === 'string' ? new Date(dia) : dia;
  return `${format(start, fmt)} – ${format(eventEndDate(dia, tipo, horario, duracionMin), fmt)}`;
}
