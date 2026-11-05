/**
 * Cálculo de mora de un contrato — FUENTE ÚNICA para la pestaña Financiera
 * (badge junto a "Corte de Pago"), el bloqueo de certificados y el informe
 * Recaudos › Usuarios en mora. Client-safe: sin imports de servidor.
 *
 * Regla: el calendario de cuotas sale de FINANCIEROS (cuota k vence =
 * fechaPago + (k-1) meses, k = 1..numeroCuotas). Se compara el nº de cuotas
 * COMPLETAS con los pagos de PAGOS_TITULARES (validados o no; abonos sumados con
 * asignarPagos() de src/lib/cuotas-pagos.ts) contra las vencidas:
 *   - PAGADO:    saldo ≤ 0, o registradas ≥ vencidas hasta el corte de este mes
 *   - EN_TIEMPO: nada vencido aún, o registradas ≥ vencidas hasta hoy
 *   - EN_MORA:   registradas < vencidas hasta hoy
 *
 * ⚠️ Los pagos de cuotas se registran en la plataforma desde ~mayo 2026: muchos
 * contratos anteriores figuran en mora sin estarlo. Por eso el bloqueo de
 * certificados va detrás de un interruptor (APP_CONFIG bloqueo_certificado_mora_activo).
 */

export type EstadoMora = 'EN_TIEMPO' | 'PAGADO' | 'EN_MORA'

export interface MoraCalculo {
  estado: EstadoMora
  diaCorte: number
  cuotasVencidas: number
  cuotasRegistradas: number
  cuotasAtrasadas: number
  /** Vencimiento de la cuota más antigua sin registrar (YYYY-MM-DD), solo EN_MORA. */
  fechaPrimeraImpaga: string | null
  diasMora: number
}

/**
 * Monto de un campo varchar/numeric de FINANCIEROS/PAGOS. Respeta el punto
 * decimal de `pg` ("214500.00") y acepta el formato con miles ("1.170.000").
 */
export function parseMonto(v: unknown): number {
  if (v == null || v === '') return NaN
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (/^-?\d+(\.\d{1,2})?$/.test(s)) return parseFloat(s)
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, ''))
}

function addMonthsUTC(d: Date, n: number): Date {
  const day = d.getUTCDate()
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  t.setUTCDate(Math.min(day, lastDay))
  return t
}

export function calcularMora(input: {
  fechaPago: string | Date | null | undefined
  numeroCuotas: number | string | null | undefined
  cuotasRegistradas: number
  saldo?: unknown
  hoy?: Date
}): MoraCalculo | null {
  if (!input.fechaPago) return null
  const base = new Date(input.fechaPago)
  if (isNaN(base.getTime())) return null
  // Fechas de corte mal digitadas (ej. año 0206, 1991, 8888): sin cálculo posible.
  const anio = base.getUTCFullYear()
  if (anio < 2015 || anio > 2100) return null
  const numeroCuotas = Number(input.numeroCuotas) || 0
  if (numeroCuotas <= 0) return null

  const diaCorte = base.getUTCDate()
  const hoy = input.hoy ?? new Date()
  const hoy0 = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  const lastDay = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() + 1, 0)).getUTCDate()
  const corteMes0 = Date.UTC(hoy.getFullYear(), hoy.getMonth(), Math.min(diaCorte, lastDay))

  const vencimientos: number[] = []
  let vencidasHoy = 0
  let vencidasEsteCorte = 0
  for (let k = 1; k <= numeroCuotas; k++) {
    const d = addMonthsUTC(base, k - 1)
    const d0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    vencimientos.push(d0)
    if (d0 <= hoy0) vencidasHoy++
    if (d0 <= corteMes0) vencidasEsteCorte++
  }

  const registradas = Math.max(0, input.cuotasRegistradas || 0)
  const res = (estado: EstadoMora): MoraCalculo => {
    const atrasadas = estado === 'EN_MORA' ? Math.max(0, vencidasHoy - registradas) : 0
    const primera = estado === 'EN_MORA' ? vencimientos[registradas] ?? null : null
    return {
      estado,
      diaCorte,
      cuotasVencidas: vencidasHoy,
      cuotasRegistradas: registradas,
      cuotasAtrasadas: atrasadas,
      fechaPrimeraImpaga: primera != null ? new Date(primera).toISOString().slice(0, 10) : null,
      diasMora: primera != null ? Math.max(0, Math.round((hoy0 - primera) / 86_400_000)) : 0,
    }
  }

  const saldo = parseMonto(input.saldo)
  if (!isNaN(saldo) && saldo <= 0) return res('PAGADO')
  if (vencidasEsteCorte === 0) return res('EN_TIEMPO')
  if (registradas >= vencidasEsteCorte) return res('PAGADO')
  if (registradas >= vencidasHoy) return res('EN_TIEMPO')
  return res('EN_MORA')
}
