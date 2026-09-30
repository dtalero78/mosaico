/**
 * La nivelación VIVA de un usuario: pedida o aprobada, y todavía sin cerrar.
 *
 * Un usuario tiene como mucho UNA. Mientras exista no se le puede pedir otra:
 * la segunda pisaría el detalle de la primera (lección, confirmación, grupo
 * armado), inflaría el conteo y —si la primera ya estaba agendada— la sacaría
 * de Pendientes, porque la regla "tiene evento" sólo cuenta el agendamiento
 * creado DESPUÉS de la fecha de la solicitud.
 *
 * El guía sólo SOLICITA. Desde que la solicitud existe la gestiona el Área de
 * Nivelación (aprobar, cancelar, devolver, remover, cerrar); el panel del guía
 * no la cambia ni la quita.
 *
 * Vive en `lib/` (cliente + servidor) porque la usan el panel de la sesión, el
 * PATCH del guía y el alta de Servicio: con una copia en cada sitio, la primera
 * corrección las desalinea.
 */

/** En qué pestaña de Servicio › Nivelaciones está la nivelación viva. */
export type EtapaNivelacion = 'SOLICITUDES' | 'AGRUPACIONES' | 'PENDIENTES'

/** `detail.tipo` del 409: con esto el panel sabe que debe abrir el modal. */
export const TIPO_NIVELACION_SIN_RESOLVER = 'nivelacion_sin_resolver'

export interface NivelacionViva {
  etapa: EtapaNivelacion
  nombre: string | null
  modulo: string | null
  leccion: string | null
  hora: string | null
  duracionMin: number | null
  motivo: string | null
  /** `detalleNivelacion.fecha`: cuándo se pidió. */
  fechaSolicitud: string | null
  /** Sólo en PENDIENTES: el horario que se le asignó. */
  fechaEvento: string | null
}

export const ETAPA_NIVELACION_META: Record<EtapaNivelacion, { pestana: string; estado: string; clase: string }> = {
  SOLICITUDES: {
    pestana: 'Solicitudes',
    estado: 'solicitada, esperando aprobación',
    clase: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  AGRUPACIONES: {
    pestana: 'Agrupaciones',
    estado: 'aprobada, esperando horario',
    clase: 'bg-sky-100 text-sky-800 border-sky-300',
  },
  PENDIENTES: {
    pestana: 'Pendientes',
    estado: 'agendada, esperando que se dicte',
    clase: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
}

/**
 * La etapa sale de las dos marcas de ACADEMICA y de si ya tiene evento.
 * Manda la aprobación: una fila con las DOS marcas (el estado que dejaba volver
 * a marcar la casilla sobre una aprobada) sigue siendo una nivelación aprobada.
 */
export function etapaNivelacion(e: {
  nivelacion?: boolean | null
  aprobadoNivelacion?: boolean | null
  tieneEvento?: boolean | null
}): EtapaNivelacion | null {
  if (e.aprobadoNivelacion === true) return e.tieneEvento ? 'PENDIENTES' : 'AGRUPACIONES'
  if (e.nivelacion === true) return 'SOLICITUDES'
  return null
}

function texto(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim()
  return s || null
}

/** `detalleNivelacion` llega como objeto; se tolera el texto por datos viejos. */
function leerDetalle(detalle: unknown): Record<string, unknown> {
  if (detalle && typeof detalle === 'object') return detalle as Record<string, unknown>
  if (typeof detalle === 'string') {
    try {
      const d = JSON.parse(detalle)
      return d && typeof d === 'object' ? d : {}
    } catch { return {} }
  }
  return {}
}

/** Arma la nivelación viva de una fila de ACADEMICA, o `null` si no tiene. */
export function armarNivelacionViva(input: {
  nivelacion?: boolean | null
  aprobadoNivelacion?: boolean | null
  detalle?: unknown
  nombre?: string | null
  tieneEvento?: boolean | null
  fechaEvento?: string | null
}): NivelacionViva | null {
  const etapa = etapaNivelacion(input)
  if (!etapa) return null
  const d = leerDetalle(input.detalle)
  const dur = Number(d.duracionMin)
  return {
    etapa,
    nombre: texto(input.nombre),
    modulo: texto(d.modulo),
    leccion: texto(d.leccion),
    hora: texto(d.hora),
    duracionMin: Number.isFinite(dur) && dur > 0 ? dur : null,
    motivo: texto(d.motivo),
    fechaSolicitud: texto(d.fecha),
    fechaEvento: etapa === 'PENDIENTES' ? texto(input.fechaEvento) : null,
  }
}

/** El texto del rechazo. Nombra al usuario: quien lo lee puede estar pidiéndola para varios. */
export function mensajeNivelacionSinResolver(viva: Pick<NivelacionViva, 'etapa' | 'nombre'>): string {
  const quien = texto(viva.nombre) || 'El usuario'
  return `No se puede solicitar otra nivelación: ${quien} tiene una sin resolver (${ETAPA_NIVELACION_META[viva.etapa].estado}).`
}
