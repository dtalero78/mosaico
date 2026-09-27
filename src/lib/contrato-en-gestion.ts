/**
 * Lista "En Gestión" de Comercial › Gestión Contrato.
 *
 * Es el CAMINO DE VUELTA al contrato recién creado. El detalle del contrato
 * (`/dashboard/comercial/contrato/[id]`) no está en ningún menú: sólo se llega
 * desde el redirect del asistente de Crear Contrato. Quien cerraba esa pestaña
 * perdía el acceso a solicitar la firma, enviar el PDF, imprimir y editar — el
 * contrato seguía existiendo, pero ya no había por dónde entrar.
 *
 * Entra a la lista el contrato que:
 *   - se creó hace menos de `HORAS_EN_GESTION` horas,
 *   - NO está marcado listo (el "Dejar listo" de esta misma pantalla), y
 *   - NO está aprobado.
 * Y sale además si alguien lo quitó a mano.
 *
 * La regla vive aquí —cliente y servidor— porque la usan DOS sitios: la consulta
 * del endpoint y la tabla, que descarta sola la fila cuyo plazo se cumple
 * mientras la página sigue abierta. Con una copia en cada lado, la pantalla
 * acabaría mostrando un contrato que el servidor ya no lista.
 */
import { esAprobado } from './estados'

/** Horas que un contrato recién creado permanece en la lista. */
export const HORAS_EN_GESTION = 8

const MS_HORA = 60 * 60 * 1000

type Instante = string | Date | null | undefined

function aMs(v: Instante): number | null {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Instante en que el contrato sale de la lista. null si no se sabe cuándo se creó. */
export function saleDeEnGestion(creado: Instante): Date | null {
  const t = aMs(creado)
  return t === null ? null : new Date(t + HORAS_EN_GESTION * MS_HORA)
}

/**
 * Milisegundos que le quedan en la lista. 0 o negativo = ya salió.
 * Sin fecha de creación devuelve 0: no se puede afirmar que siga dentro del plazo.
 */
export function msRestantesEnGestion(creado: Instante, ahora: Date = new Date()): number {
  const sale = saleDeEnGestion(creado)
  return sale ? sale.getTime() - ahora.getTime() : 0
}

export interface FilaEnGestion {
  creado: Instante
  gestionListo?: boolean | null
  aprobacion?: string | null
  quitadoEn?: Instante
}

/**
 * ¿El contrato pertenece a la lista? Espejo exacto del WHERE del endpoint.
 * `incluirQuitados` es la casilla "Ver los quitados": levanta SÓLO esa condición,
 * nunca el plazo ni las otras dos.
 */
export function entraEnGestion(
  fila: FilaEnGestion,
  ahora: Date = new Date(),
  incluirQuitados = false,
): boolean {
  if (fila.gestionListo === true) return false
  if (esAprobado(fila.aprobacion)) return false
  if (!incluirQuitados && fila.quitadoEn) return false
  return msRestantesEnGestion(fila.creado, ahora) > 0
}

/** "7 h 20 min" · "45 min" · "menos de 1 min". */
export function textoRestante(ms: number): string {
  if (ms <= 0) return 'plazo cumplido'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'menos de 1 min'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
