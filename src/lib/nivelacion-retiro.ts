/**
 * Sacar una nivelación de AGRUPACIONES sin agendarla.
 *
 * Hasta ahora una nivelación aprobada sólo podía avanzar (agruparse y agendarse)
 * o esperar a que el cron del jueves la cancelara por falta de confirmación. No
 * había forma de corregir una aprobación hecha por error ni de quitar una que ya
 * no se va a dictar. Las dos salidas:
 *
 *  - **devolver**: deshace la aprobación. La nivelación vuelve a Solicitudes tal
 *    como la pidió el guía (lección, hora, duración, motivo), con la confirmación
 *    del usuario y el conteo intactos. Es reversible: se puede volver a aprobar.
 *  - **remover**: la cancela. Queda en el Histórico como «Removida», con el
 *    motivo, quién y cuándo, y el conteo del usuario baja 1 —igual que cuando la
 *    cancela el cron o el guía la cierra como no asistida: esa nivelación no se
 *    dictó, así que no cuenta como una de las suyas.
 *
 * Aquí vive sólo lo que no toca la base, para que las pruebas lo carguen; el
 * endpoint (`nivelaciones/retirar`) hace las escrituras.
 */
export const ACCIONES_RETIRO = ['devolver', 'remover'] as const
export type AccionRetiro = typeof ACCIONES_RETIRO[number]

/** Tope por operación, el mismo de `grupo-borrador`. */
export const MAX_RETIRO = 60

export function esAccionRetiro(v: unknown): v is AccionRetiro {
  return typeof v === 'string' && (ACCIONES_RETIRO as readonly string[]).includes(v)
}

/**
 * Qué falta para poder ejecutar la acción. `null` = se puede.
 * El motivo se exige sólo al remover: devolver no destruye nada, y remover deja
 * una cancelación que alguien tendrá que poder explicar después.
 */
export function motivoRechazoRetiro(
  accion: unknown,
  academicaIds: readonly string[],
  motivo: string | null | undefined
): string | null {
  if (!esAccionRetiro(accion)) return 'accion debe ser "devolver" o "remover"'
  if (!academicaIds.length) return 'Selecciona al menos un usuario'
  if (academicaIds.length > MAX_RETIRO) return `Máximo ${MAX_RETIRO} usuarios por operación`
  if (accion === 'remover' && !String(motivo || '').trim()) {
    return 'El motivo es obligatorio para remover una nivelación'
  }
  return null
}

/** Marcas que se suman a `detalleNivelacion` al devolverla a Solicitudes. */
export function marcasDevolucion(actor: string, ahora: Date = new Date()) {
  return { devueltaEn: ahora.toISOString(), devueltaPor: actor }
}

/** El conteo después de remover: baja 1 y nunca queda negativo. */
export function conteoAlRemover(conteo: number | null | undefined): number {
  return Math.max(0, (Number(conteo) || 0) - 1)
}

/**
 * La entrada de `NivelacionHistory` de una nivelación removida.
 * `conteo` es el número de ESTA nivelación (el valor antes de bajarlo), como en
 * los demás cierres. `fechaEvento` va en null: nunca llegó a agendarse.
 */
export function entradaRemovida(args: {
  detalle: Record<string, any> | null | undefined
  conteo: number | null | undefined
  motivo: string
  actor: string
  ahora?: Date
}) {
  const det = args.detalle || {}
  return {
    fecha: (args.ahora || new Date()).toISOString(),
    fechaEvento: null,
    fechaSolicitud: det.fecha || null,
    modulo: det.modulo || null,
    leccion: det.leccion || null,
    conteo: Number(args.conteo) || 0,
    confirmadoEn: det.confirmadoEn || null,
    confirmadoPor: det.confirmadoPor || null,
    resultado: 'REMOVIDA' as const,
    comentario: args.motivo.trim(),
    marcadoPor: args.actor,
    cerradoPorServicio: true,
  }
}
