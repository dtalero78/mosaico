/**
 * Talleres (eventos tipo CLUB): reglas puras compartidas por Servicio › Talleres,
 * el endpoint de recordatorio y las pruebas.
 */
import { TZ_OPERACION } from './cursos-campaign'

/** Slug de la plantilla que se envía como recordatorio. */
export const SLUG_RECORDATORIO_TALLER = 'recordatorio-taller'

/** Tope de destinatarios por envío, el mismo de Envío de Mensajes. */
export const MAX_RECORDATORIOS = 300

/**
 * Minutos que un taller sigue en "Próximos" después de empezar: mientras se
 * dicta todavía es el taller de hoy, no historia. Coincide con la duración por
 * defecto de un evento.
 */
export const MIN_TALLER_EN_CURSO = 60

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * Fecha y hora del taller como van en el mensaje, SIEMPRE en hora de Chile
 * (decisión del usuario): `{ fecha: 'viernes 16-10-2026', hora: '18:00' }`.
 * Se formatea con la zona explícita para que no dependa del reloj del servidor.
 */
export function fechaHoraTaller(dia: Date | string | null | undefined): { fecha: string; hora: string } {
  if (!dia) return { fecha: '', hora: '' }
  const d = dia instanceof Date ? dia : new Date(dia)
  if (isNaN(d.getTime())) return { fecha: '', hora: '' }
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ_OPERACION, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(d).map(p => [p.type, p.value])
  )
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(partes.weekday))
  const hora = `${partes.hour === '24' ? '00' : partes.hour}:${partes.minute}`
  return { fecha: `${DIAS[idx] ?? ''} ${partes.day}-${partes.month}-${partes.year}`.trim(), hora }
}

/** ¿El taller ya terminó? Entonces es del Histórico y no admite recordatorio. */
export function tallerTerminado(dia: Date | string, now: Date = new Date()): boolean {
  const d = dia instanceof Date ? dia : new Date(dia)
  return d.getTime() + MIN_TALLER_EN_CURSO * 60_000 <= now.getTime()
}

/** Origen del agendamiento como se muestra: el alumno se inscribió solo o lo agendó el personal. */
export function etiquetaOrigenTaller(origen: string | null | undefined): string {
  return String(origen || '').toUpperCase() === 'PANEL_EST' ? 'Se inscribió (panel)' : 'Agendado por personal'
}
