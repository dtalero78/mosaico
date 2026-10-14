import { hoyEnChile } from '@/lib/cursos-campaign'

/**
 * Gestión Justificación — reglas compartidas por la pantalla y el servidor.
 *
 * El período por defecto es el ÚLTIMO MES: del mismo día del mes anterior hasta
 * hoy, contado en hora de CHILE (si se tomara el reloj del navegador, alguien en
 * Colombia vería el rango corrido un día). Se precarga VISIBLE en los filtros y
 * el servidor lo usa como respaldo si no le llegan fechas.
 */
export function rangoUltimoMes(now: Date = new Date()): { desde: string; hasta: string } {
  const hasta = hoyEnChile(now)
  const [y, m, d] = hasta.split('-').map(Number)
  // Mismo día del mes anterior; si no existe (31-mar → 31-feb) se ajusta al
  // último día de ese mes.
  const ultimoDiaMesAnterior = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
  const desdeDate = new Date(Date.UTC(y, m - 2, Math.min(d, ultimoDiaMesAnterior)))
  return { desde: desdeDate.toISOString().slice(0, 10), hasta }
}

/** Largo máximo del motivo (mismo tope razonable que el modal de la sesión). */
export const MAX_MOTIVO_JUSTIFICACION = 500
