/**
 * Recuperar a Solicitudes una nivelación que el cron canceló por falta de
 * confirmación (`CANCELADA_SIN_CONFIRMAR`).
 *
 * El cron del jueves 22:00 cancela lo que nadie confirmó: le resta 1 al conteo,
 * borra `detalleNivelacion` y deja la entrada en `NivelacionHistory`. A veces la
 * cancelación no corresponde (el apoderado avisó tarde, Servicio no alcanzó a
 * confirmar), y hasta ahora la única salida era que el guía la pidiera de nuevo.
 *
 * Recuperar deja la nivelación como recién pedida (en Solicitudes, sin aprobar):
 *   - el conteo SUBE 1 — devuelve lo que el cron quitó, porque vuelve a ser una
 *     nivelación viva;
 *   - el plazo de confirmación corre de nuevo DESDE LA RECUPERACIÓN
 *     (`recuperadaEn`), no desde la fecha original: con la fecha original el
 *     cron la volvería a cancelar en su siguiente corrida, porque ese corte ya
 *     pasó. La fecha de solicitud original se conserva para mostrarla;
 *   - la entrada del histórico NO se borra: queda marcada `recuperadaEn/Por`,
 *     así se sabe que se canceló y que alguien la recuperó, y no se puede
 *     recuperar dos veces.
 *
 * Desde oct-2026 el cron guarda la solicitud completa en `solicitud` (hora,
 * duración, motivo, guía). Las canceladas antes sólo guardaron módulo, lección y
 * fecha: vuelven sin hora, duración ni motivo.
 *
 * Aquí vive sólo lo que no toca la base, para que las pruebas lo carguen; el
 * endpoint (`nivelaciones/recuperar`) hace las escrituras.
 */

/** Tope por operación, el mismo de Devolver/Remover. */
export const MAX_RECUPERACION = 60

export interface EntradaHistorial {
  fecha?: string | null
  resultado?: string | null
  fechaSolicitud?: string | null
  modulo?: string | null
  leccion?: string | null
  solicitud?: Record<string, any> | null
  recuperadaEn?: string | null
  recuperadaPor?: string | null
  [k: string]: any
}

/**
 * Por qué ESTA entrada no se puede recuperar. `null` = se puede.
 *
 * `esUltima`: sólo se recupera la última entrada del alumno. Si después de la
 * cancelación hubo otra nivelación (cerrada), el ciclo ya siguió y revivir una
 * anterior mezclaría las dos.
 */
export function motivoNoRecuperable(
  entrada: EntradaHistorial | null | undefined,
  opts: { esUltima: boolean; tieneNivelacionViva: boolean }
): string | null {
  if (!entrada) return 'la nivelación ya no está en el histórico'
  if (entrada.resultado !== 'CANCELADA_SIN_CONFIRMAR') return 'sólo se recuperan las canceladas por falta de confirmación'
  if (entrada.recuperadaEn) return 'ya fue recuperada'
  if (!opts.esUltima) return 'tuvo otra nivelación después de esta cancelación'
  if (opts.tieneNivelacionViva) return 'ya tiene otra nivelación en curso'
  return null
}

/** Campos de confirmación y de grupo que NO deben sobrevivir a la recuperación. */
const CAMPOS_DESCARTADOS = [
  'confirmadoEn', 'confirmadoPor', 'confirmadoPorNombre', 'grupoId', 'devueltaEn', 'devueltaPor',
]

/**
 * El `detalleNivelacion` de la nivelación recuperada. Parte de la solicitud
 * guardada por el cron (si la hay) y garantiza módulo, lección y fecha original.
 */
export function detalleRecuperado(entrada: EntradaHistorial, actor: string, ahora: Date = new Date()) {
  const base: Record<string, any> = { ...(entrada.solicitud || {}) }
  for (const k of CAMPOS_DESCARTADOS) delete base[k]
  return {
    ...base,
    modulo: base.modulo || entrada.modulo || null,
    leccion: base.leccion || entrada.leccion || null,
    fecha: base.fecha || entrada.fechaSolicitud || ahora.toISOString(),
    recuperadaEn: ahora.toISOString(),
    recuperadaPor: actor,
  }
}

/** La entrada del histórico, marcada como recuperada. */
export function marcarRecuperada(entrada: EntradaHistorial, actor: string, ahora: Date = new Date()): EntradaHistorial {
  return { ...entrada, recuperadaEn: ahora.toISOString(), recuperadaPor: actor }
}

/** El conteo al recuperar: devuelve el que restó el cron. */
export function conteoAlRecuperar(conteo: number | null | undefined): number {
  return (Number(conteo) || 0) + 1
}
