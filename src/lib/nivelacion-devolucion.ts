/**
 * Devolver a Pendientes una nivelación que ya está en el Histórico.
 *
 * Caso típico: Servicio la cerró desde Pendientes como «No asistió — no
 * contestó» y después el usuario sí respondió (o se cerró por error). Hasta ahora
 * no había cómo deshacerlo.
 *
 * Devolver deja la nivelación como estaba antes de cerrarla: aprobada, con su
 * evento, esperando que se dicte (pestaña Pendientes):
 *   - sólo se devuelven los cierres de INASISTENCIA (`NO_ASISTIO`,
 *     `NO_ASISTIO_JUSTIFICO`, `NO_ASISTIO_NO_CONTESTO`). Una «Realizada» tiene
 *     asistencia y participación marcadas en el agendamiento; deshacerla es otra
 *     decisión (hay que corregir la sesión), no un botón;
 *   - el agendamiento NO se toca: ningún cierre lo canceló, sigue vivo;
 *   - el conteo sólo sube en `NO_ASISTIO` (el cierre del guía lo había bajado);
 *     los cierres de Servicio nunca lo tocaron;
 *   - la entrada del Histórico NO se borra: queda marcada `devueltaPendienteEn/Por`
 *     y no se puede devolver dos veces;
 *   - sólo la ÚLTIMA entrada del alumno y sin otra nivelación viva.
 *
 * Aquí vive sólo lo que no toca la base, para que las pruebas lo carguen.
 */

export const MAX_DEVOLUCION = 60

export const RESULTADOS_DEVOLVIBLES = ['NO_ASISTIO', 'NO_ASISTIO_JUSTIFICO', 'NO_ASISTIO_NO_CONTESTO'] as const

export interface EntradaDevolvible {
  fecha?: string | null
  resultado?: string | null
  fechaEvento?: string | null
  fechaSolicitud?: string | null
  modulo?: string | null
  leccion?: string | null
  solicitud?: Record<string, any> | null
  confirmadoEn?: string | null
  confirmadoPor?: string | null
  devueltaPendienteEn?: string | null
  devueltaPendientePor?: string | null
  recuperadaEn?: string | null
  [k: string]: any
}

/** Por qué ESTA entrada no se puede devolver. `null` = se puede. */
export function motivoNoDevolvible(
  entrada: EntradaDevolvible | null | undefined,
  opts: { esUltima: boolean; tieneNivelacionViva: boolean }
): string | null {
  if (!entrada) return 'la nivelación ya no está en el histórico'
  if (!RESULTADOS_DEVOLVIBLES.includes(entrada.resultado as any)) return 'sólo se devuelven las nivelaciones cerradas como «No asistió»'
  if (entrada.devueltaPendienteEn) return 'ya fue devuelta a Pendientes'
  if (!opts.esUltima) return 'tuvo otra nivelación después de este cierre'
  if (opts.tieneNivelacionViva) return 'ya tiene otra nivelación en curso'
  return null
}

/**
 * La fecha de solicitud del detalle restaurado. Pendientes sólo cuenta el
 * agendamiento creado DESPUÉS de la solicitud (`lib/nivelacion-agendamiento`),
 * así que si la original faltara (entradas viejas) o fuera posterior al
 * agendamiento, se usa un minuto antes de él: la nivelación sigue siendo suya.
 */
export function fechaSolicitudRestaurada(
  fechaSolicitud: string | null | undefined,
  agendamientoCreadoEn: string | Date
): string {
  const ag = new Date(agendamientoCreadoEn).getTime()
  const sol = fechaSolicitud ? new Date(fechaSolicitud).getTime() : NaN
  if (!Number.isNaN(sol) && sol <= ag) return new Date(sol).toISOString()
  return new Date(ag - 60_000).toISOString()
}

/** El `detalleNivelacion` restaurado (la confirmación del usuario se conserva). */
export function detalleDevuelto(
  entrada: EntradaDevolvible,
  agendamientoCreadoEn: string | Date,
  actor: string,
  ahora: Date = new Date()
) {
  const base: Record<string, any> = { ...(entrada.solicitud || {}) }
  for (const k of ['grupoId', 'devueltaEn', 'devueltaPor']) delete base[k]
  return {
    ...base,
    modulo: base.modulo || entrada.modulo || null,
    leccion: base.leccion || entrada.leccion || null,
    fecha: fechaSolicitudRestaurada(base.fecha || entrada.fechaSolicitud, agendamientoCreadoEn),
    confirmadoEn: entrada.confirmadoEn || base.confirmadoEn || undefined,
    confirmadoPor: entrada.confirmadoPor || base.confirmadoPor || undefined,
    devueltaPendienteEn: ahora.toISOString(),
    devueltaPendientePor: actor,
  }
}

/** La entrada del histórico, marcada como devuelta. */
export function marcarDevuelta<T extends EntradaDevolvible>(entrada: T, actor: string, ahora: Date = new Date()): T {
  return { ...entrada, devueltaPendienteEn: ahora.toISOString(), devueltaPendientePor: actor }
}

/** El cierre del guía bajó el conteo; los de Servicio nunca lo tocaron. */
export function conteoAlDevolver(resultado: string | null | undefined, conteo: number | null | undefined): number {
  const c = Number(conteo) || 0
  return resultado === 'NO_ASISTIO' ? c + 1 : c
}
