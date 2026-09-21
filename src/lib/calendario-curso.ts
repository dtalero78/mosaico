/**
 * Qué días tiene clase un curso de campaña (cliente + servidor, sin base de datos).
 *
 * Es la regla del generador de eventos (`generarEventosCurso`) sacada a una
 * función pura, para que la usen también el CIERRE y la AMPLIACIÓN de
 * Académico › Campañas › Ajuste Cursos. Con dos copias, la primera corrección las
 * desalinea y una ampliación dejaría fechas distintas de las que saldrían al
 * regenerar el curso.
 *
 * La regla:
 *  - El nº de clases es el nº de días-clase del horario en [inicio, fin] (la
 *    ventana NOMINAL del curso).
 *  - Un día sin clase (feriado de Chile, festivo declarado o suspensión del curso)
 *    no se agenda: esa clase se CORRE al final, después de `fin`. Por eso la
 *    última clase real suele caer después del Final curso.
 *  - `hasta` es el tope de un CIERRE: nunca se agenda después de esa fecha, aunque
 *    queden clases corridas por festivos.
 */
import { fechasEntre } from './cursos-campaign';

/** iso + n días (UTC, sin desfase de zona horaria). */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

export interface FechasCursoInput {
  /** Inicio del curso (YYYY-MM-DD). */
  inicio: string;
  /** Final NOMINAL del curso (YYYY-MM-DD): cuenta cuántas clases tiene. */
  fin: string;
  /** Días de la semana del horario (0 = domingo … 6 = sábado). */
  dias: number[];
  /** true si ese día no se dicta clase (feriado, festivo declarado, suspensión). */
  noHayClase: (fecha: string) => boolean;
  /** Tope de seguridad de clases por curso. */
  max?: number;
  /** Tope de un cierre: no se agenda después de esta fecha (YYYY-MM-DD). */
  hasta?: string | null;
}

/** Fechas (YYYY-MM-DD, ordenadas) en que el curso tiene clase. */
export function calcularFechasCurso({ inicio, fin, dias, noHayClase, max = 2000, hasta = null }: FechasCursoInput): string[] {
  if (!inicio || !fin) return [];
  const base = fechasEntre(inicio.slice(0, 10), fin.slice(0, 10), dias);
  if (base.length === 0) return [];

  const objetivo = Math.min(base.length, max);
  let fechas = base.filter((d) => !noHayClase(d));
  if (fechas.length < objetivo) {
    let cursor = fin.slice(0, 10);
    let guard = 0;
    while (fechas.length < objetivo && guard < 520) {
      for (const d of fechasEntre(addDaysISO(cursor, 1), addDaysISO(cursor, 7), dias)) {
        if (!noHayClase(d)) { fechas.push(d); if (fechas.length >= objetivo) break; }
      }
      cursor = addDaysISO(cursor, 7);
      guard++;
    }
  }
  if (fechas.length > objetivo) fechas = fechas.slice(0, objetivo);
  fechas.sort();
  if (hasta) fechas = fechas.filter((d) => d <= hasta.slice(0, 10));
  return fechas;
}

/**
 * Clases que agrega una AMPLIACIÓN: las del calendario completo con el nuevo final
 * que caen DESPUÉS de la última clase existente. Las anteriores ya están creadas
 * (y pueden tener asistencia), así que no se tocan.
 */
export function fechasAmpliacion(objetivo: string[], ultimaClase: string | null): string[] {
  const u = ultimaClase ? ultimaClase.slice(0, 10) : '';
  return objetivo.filter((d) => !u || d > u);
}
