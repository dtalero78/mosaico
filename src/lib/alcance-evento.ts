/**
 * ¿Un TALLER u OLIMPIADA del calendario es para este alumno?
 *
 * Se crean desde el calendario con Campaña · Curso · Salón; "Todos" (o vacío)
 * es el comodín que abre esa dimensión al resto. El evento es del alumno si
 * coincide en las TRES:
 *   - campaña: el mismo "KODOMO · Salón 06" existe en varias campañas con otro
 *     guía, así que sin la campaña un taller de AGOSTO le aparecía a JUNIO;
 *   - curso;
 *   - salón, que puede ser una LISTA ("01, 03": un taller para varios salones).
 *
 * Si al alumno le falta un dato, esa dimensión no lo restringe (es lo mismo que
 * hace la consulta de la lista: el filtro sólo se aplica si hay valor).
 *
 * La consulta SQL de `calendar.repository` (`campaignAlumno`, `cursoAlumno`,
 * `salonAlumno`) aplica esta MISMA regla para armar la lista; esta función la
 * aplica el servidor al agendar. Con dos reglas distintas, la lista ofrecería lo
 * que después se rechaza (o al revés).
 */

/** Tipos que el alumno puede agendar desde su panel. */
export const TIPOS_AGENDABLES_PANEL = ['CLUB', 'OLIMPIADA'] as const

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
const esComodin = (v: unknown) => ['', 'TODOS'].includes(norm(v))

export interface EventoAlcance { campaign?: string | null; curso?: string | null; salon?: string | null }
export interface AlumnoAlcance { campaign?: string | null; curso?: string | null; salon?: string | null }

/** Motivo por el que el evento NO es del alumno, o null si sí lo es. */
export function motivoFueraDeAlcance(ev: EventoAlcance, al: AlumnoAlcance): string | null {
  if (norm(al.campaign) && !esComodin(ev.campaign) && norm(ev.campaign) !== norm(al.campaign)) {
    return `es de la campaña ${ev.campaign}`
  }
  if (norm(al.curso) && !esComodin(ev.curso) && norm(ev.curso) !== norm(al.curso)) {
    return `es del curso ${ev.curso}`
  }
  if (norm(al.salon) && !esComodin(ev.salon)) {
    const salones = String(ev.salon).split(',').map(norm).filter(Boolean)
    if (!salones.includes(norm(al.salon))) return `es del salón ${ev.salon}`
  }
  return null
}

export const eventoEnAlcance = (ev: EventoAlcance, al: AlumnoAlcance) => motivoFueraDeAlcance(ev, al) === null
