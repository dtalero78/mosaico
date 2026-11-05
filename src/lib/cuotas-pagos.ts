/**
 * Asignación de pagos a cuotas — FUENTE ÚNICA (client-safe, sin imports de servidor).
 *
 * ⚠️ Copiado de LGS. MOSAICO aún NO tiene `numPago` (N° de pago por recibo): aquí
 * `numCuota` es la cuota donde EMPIEZA a aplicarse el pago, y dos abonos a la misma
 * cuota sólo se reconocen si se registraron con el mismo `numCuota`.
 *
 * Regla de asignación: cada pago cubre `valorPagado + descuento` (el descuento
 * completa la cuota igual que el efectivo), empieza en SU cuota y desborda hacia
 * adelante; nunca rellena hacia atrás. Orden: cuota aplicada, luego fecha de pago,
 * luego fecha de registro.
 *
 * "Cuotas completas" se calcula, no se digita. Alimenta Cuotas Pagadas, la mora,
 * el Estado de Cuenta y Recaudos.
 *
 * Etiqueta de cada cuota completa:
 *   - Pago normal                    un solo pago, sin descuento
 *   - Pago con descuento             un solo pago, con descuento
 *   - Pago con abonos                dos o más pagos
 *   - Pago con abonos y descuento    dos o más pagos y alguno con descuento
 *   - Pago cuota                     un pago la completó y cubrió entera la siguiente
 *   - Pago adelantado                la cubrió entera el sobrante del pago anterior
 * Cuota incompleta con algo abonado: "Abono parcial".
 */

export interface PagoAsignable {
  _id?: string | null
  numCuota?: number | string | null
  fechaPago?: string | Date | null
  _createdDate?: string | Date | null
  valorPagado?: unknown
  descuento?: unknown
  inscripcion?: unknown
  validado?: boolean | null
}

export interface AporteCuota {
  pagoId: string | null
  fechaPago: string | Date | null
  /** Cobertura aplicada a esta cuota (efectivo + descuento). */
  monto: number
  /** Parte de `monto` que es descuento. */
  descuento: number
  /** El pago empezó en esta cuota (false = llegó por desborde de una anterior). */
  propio: boolean
  validado: boolean
}

export type EtiquetaCuota =
  | 'Pago normal'
  | 'Pago con descuento'
  | 'Pago con abonos'
  | 'Pago con abonos y descuento'
  | 'Pago cuota'
  | 'Pago adelantado'
  | 'Abono parcial'

export interface CuotaAsignada {
  /** 0 = inscripción, 1..N = cuotas. */
  n: number
  valor: number
  cubierto: number
  falta: number
  completa: boolean
  aportes: AporteCuota[]
  etiqueta: EtiquetaCuota | null
}

export interface AsignacionPagos {
  cuotas: CuotaAsignada[]
  /** Cuotas 1..N completas (la inscripción no cuenta). */
  cuotasCompletas: number
  /** Última cuota (1..N) completa de forma consecutiva desde la 1; 0 si ninguna. */
  ultimaCuotaCompleta: number
  /**
   * Primera cuota incompleta (0 = inscripción); null si todo está cubierto. No mira
   * las cuotas anteriores a la primera registrada en la plataforma: los pagos de
   * antes de ~mayo-2026 se hicieron por fuera y su contrato empieza, p. ej., en la 5.
   */
  primeraIncompleta: number | null
  /** Cobertura que sobró después de la última cuota. */
  sobrante: number
}

/** Monto de un campo numeric/varchar (respeta "214500.00" y "1.170.000"). */
export function montoDe(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  // "90.000" / "1.170.000" = miles (FINANCIEROS legacy); "214500.00" = decimal (pg numeric).
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

const ts = (v: unknown): number => {
  if (!v) return 0
  const t = (v instanceof Date ? v : new Date(v as any)).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Cuota donde empieza el pago (0 = inscripción). */
export function cuotaAplicada(p: PagoAsignable): number {
  let k = p.numCuota == null || p.numCuota === '' ? NaN : Number(p.numCuota)
  if ((Number.isNaN(k) || k < 0) && (p.inscripcion === true || montoDe(p.inscripcion) > 0)) k = 0
  return Number.isNaN(k) ? 0 : Math.max(0, Math.floor(k))
}

/** Orden de asignación: cuota aplicada → fecha de pago → fecha de registro. */
export function ordenarPagos<T extends PagoAsignable>(pagos: T[]): T[] {
  return [...pagos].sort((a, b) => {
    const ka = cuotaAplicada(a), kb = cuotaAplicada(b)
    if (ka !== kb) return ka - kb
    const fa = ts(a.fechaPago), fb = ts(b.fechaPago)
    if (fa !== fb) return fa - fb
    return ts(a._createdDate) - ts(b._createdDate)
  })
}

export function asignarPagos(input: {
  inscripcion: number
  valorCuota: number
  numeroCuotas: number
  pagos: PagoAsignable[]
}): AsignacionPagos {
  const numeroCuotas = Math.max(0, Math.floor(Number(input.numeroCuotas) || 0))
  const valores = [Math.max(0, input.inscripcion || 0), ...Array.from({ length: numeroCuotas }, () => Math.max(0, input.valorCuota || 0))]
  const cuotas: CuotaAsignada[] = valores.map((valor, n) => ({
    n, valor, cubierto: 0, falta: valor, completa: valor <= 0.5, aportes: [], etiqueta: null,
  }))
  let sobrante = 0

  for (const p of ordenarPagos(input.pagos)) {
    const start = Math.min(cuotaAplicada(p), cuotas.length - 1)
    let restante = montoDe(p.valorPagado) + montoDe(p.descuento)
    let descRestante = montoDe(p.descuento)
    let i = start
    while (restante > 0.5 && i < cuotas.length) {
      const c = cuotas[i]
      const falta = c.valor - c.cubierto
      if (falta <= 0.5) { i++; continue }
      const aplica = Math.min(restante, falta)
      // El descuento se aplica primero: queda en la cuota donde empieza el pago.
      const desc = Math.min(descRestante, aplica)
      descRestante -= desc
      c.cubierto += aplica
      c.aportes.push({
        pagoId: p._id ?? null, fechaPago: p.fechaPago ?? null, monto: aplica, descuento: desc,
        propio: i === start, validado: p.validado === true,
      })
      restante -= aplica
      if (c.cubierto >= c.valor - 0.5) i++
    }
    if (restante > 0.5) {
      // Lo que sobra al final del contrato tapa las cuotas que quedaron cortas
      // (p. ej. un pago de 320.000 y el siguiente de 324.000 sobre cuotas de 322.000):
      // sin esto, un contrato pagado al 100% mostraría una cuota "a medias".
      for (let j = start - 1; j >= 1 && restante > 0.5; j--) {
        const c = cuotas[j]
        const falta = c.valor - c.cubierto
        if (falta <= 0.5) continue
        const aplica = Math.min(restante, falta)
        c.cubierto += aplica
        c.aportes.push({
          pagoId: p._id ?? null, fechaPago: p.fechaPago ?? null, monto: aplica, descuento: 0,
          propio: false, validado: p.validado === true,
        })
        restante -= aplica
      }
      if (restante > 0.5) sobrante += restante
    }
  }

  const completaPorUnSoloPago = (c: CuotaAsignada) =>
    c.completa && c.aportes.length === 1

  for (const c of cuotas) {
    c.cubierto = Math.min(c.valor, c.cubierto)
    c.falta = Math.max(0, c.valor - c.cubierto)
    c.completa = c.falta <= 0.5
  }
  for (let i = 0; i < cuotas.length; i++) {
    const c = cuotas[i]
    if (c.valor <= 0.5) continue
    if (!c.completa) { c.etiqueta = c.cubierto > 0.5 ? 'Abono parcial' : null; continue }
    const conDescuento = c.aportes.some(a => a.descuento > 0.5)
    if (c.aportes.length >= 2) { c.etiqueta = conDescuento ? 'Pago con abonos y descuento' : 'Pago con abonos'; continue }
    const a = c.aportes[0]
    if (!a) continue
    if (!a.propio) { c.etiqueta = 'Pago adelantado'; continue }
    if (conDescuento) { c.etiqueta = 'Pago con descuento'; continue }
    const sig = cuotas[i + 1]
    const mismoPago = sig && completaPorUnSoloPago(sig) && sig.aportes[0].pagoId === a.pagoId && a.pagoId != null
    c.etiqueta = mismoPago ? 'Pago cuota' : 'Pago normal'
  }

  let cuotasCompletas = 0
  let ultimaCuotaCompleta = 0
  let consecutiva = true
  for (const c of cuotas) {
    if (c.n === 0) continue
    if (c.completa) {
      cuotasCompletas++
      if (consecutiva) ultimaCuotaCompleta = c.n
    } else consecutiva = false
  }
  const inicios = input.pagos.map(cuotaAplicada).filter(k => k > 0)
  const inicioRegistro = inicios.length ? Math.min(...inicios) : 1
  const primera = cuotas.find(c => !c.completa && (c.n === 0 || c.n >= inicioRegistro))

  return { cuotas, cuotasCompletas, ultimaCuotaCompleta, primeraIncompleta: primera ? primera.n : null, sobrante }
}

/** Cómo se repartiría un pago NUEVO (vista previa del wizard). */
export function simularPago(asig: AsignacionPagos, numCuota: number, valorPagado: number, descuento: number): {
  reparto: { n: number; aplica: number; completa: boolean; falta: number }[]
  sobrante: number
  esAbono: boolean
} {
  const cuotas = asig.cuotas.map(c => ({ ...c }))
  let restante = Math.max(0, valorPagado) + Math.max(0, descuento)
  const reparto: { n: number; aplica: number; completa: boolean; falta: number }[] = []
  let i = Math.min(Math.max(0, numCuota), cuotas.length - 1)
  while (restante > 0.5 && i >= 0 && i < cuotas.length) {
    const c = cuotas[i]
    const falta = c.valor - c.cubierto
    if (falta <= 0.5) { i++; continue }
    const aplica = Math.min(restante, falta)
    c.cubierto += aplica
    restante -= aplica
    const quedaFalta = Math.max(0, c.valor - c.cubierto)
    reparto.push({ n: c.n, aplica, completa: quedaFalta <= 0.5, falta: quedaFalta })
    if (quedaFalta <= 0.5) i++
  }
  // Es abono si alguna cuota tocada queda incompleta o ya tenía abonos previos.
  const esAbono = reparto.some(r => !r.completa)
    || reparto.some(r => (asig.cuotas[r.n]?.cubierto ?? 0) > 0.5)
  return { reparto, sobrante: restante > 0.5 ? restante : 0, esAbono }
}
