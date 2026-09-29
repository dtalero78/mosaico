/**
 * Asistencia a la bienvenida (WELCOME), medida por ALUMNO y no por agendamiento.
 *
 * Un alumno puede tener varios agendamientos de bienvenida: faltó a la primera,
 * se le reagendó y asistió a la segunda. Su primera fila sigue existiendo —es su
 * historia—, pero ese alumno YA asistió: no es una inasistencia que gestionar.
 * Por eso «No asistió» es sólo quien no ha asistido a NINGUNA bienvenida.
 *
 * Client + server safe (sin 'server-only'): lo usan la bandeja de Welcome, su
 * exportación y los tests.
 */

export type EstadoWelcome = 'ASISTIO' | 'ASISTIO_OTRA' | 'NO_ASISTIO' | 'PENDIENTE';

export interface FilaWelcome {
  /** Asistió a ESTA sesión. */
  asistencia?: boolean | null;
  /** El alumno asistió a alguna bienvenida (ésta u otra). */
  asistioAlguna?: boolean | null;
  fechaEvento: string | Date;
}

/**
 * Estado de una fila de la bandeja.
 *
 * - `ASISTIO`: asistió a esta sesión.
 * - `ASISTIO_OTRA`: faltó a ésta, pero asistió a otra bienvenida.
 * - `PENDIENTE`: la sesión todavía no ocurre. Manda la FECHA y no la columna:
 *   el agendamiento nace con la asistencia en `false`, así que mirarla sola
 *   daba por inasistente a quien aún no ha tenido su sesión.
 * - `NO_ASISTIO`: la sesión ya pasó y el alumno no ha asistido a ninguna.
 */
export function estadoWelcome(fila: FilaWelcome, now: Date = new Date()): EstadoWelcome {
  if (fila.asistencia === true) return 'ASISTIO';
  if (fila.asistioAlguna === true) return 'ASISTIO_OTRA';
  if (new Date(fila.fechaEvento).getTime() > now.getTime()) return 'PENDIENTE';
  return 'NO_ASISTIO';
}

export const ESTADO_WELCOME_META: Record<EstadoWelcome, { label: string; badge: string }> = {
  ASISTIO: { label: 'Asistió', badge: 'badge-success' },
  ASISTIO_OTRA: { label: 'Asistió a otra sesión', badge: 'badge-success' },
  NO_ASISTIO: { label: 'No asistió', badge: 'badge-danger' },
  PENDIENTE: { label: 'Pendiente', badge: 'badge-warning' },
};

export type FiltroAsistenciaWelcome = 'all' | 'attended' | 'not-attended' | 'pending';

/**
 * ¿La fila entra en el filtro de asistencia elegido?
 *
 * «Asistió» lista la sesión a la que el alumno SÍ asistió (una fila por
 * alumno); la sesión a la que faltó antes sólo se ve en «Todos».
 */
export function pasaFiltroAsistencia(estado: EstadoWelcome, filtro: FiltroAsistenciaWelcome): boolean {
  if (filtro === 'attended') return estado === 'ASISTIO';
  if (filtro === 'not-attended') return estado === 'NO_ASISTIO';
  if (filtro === 'pending') return estado === 'PENDIENTE';
  return true;
}
