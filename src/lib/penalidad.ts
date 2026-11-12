/**
 * Penalidad de cierre a cuotas — lógica pura (cliente + servidor).
 *
 * El titular desiste del programa y se acuerda que paga sólo el 30% del saldo pendiente,
 * en las cuotas que se pacten; el 70% restante se condona al pagar la última cuota.
 */

export const PORCENTAJE_PENALIDAD = 30;
export const MAX_PENALIDADES_POR_CONTRATO = 2;
export const MAX_CUOTAS_PENALIDAD = 24;
export const ESTADO_CIERRE_A_CUOTAS = 'CIERRE A CUOTAS';

export interface CuotaPenalidad {
  n: number;
  valor: number;
  /** Vencimiento YYYY-MM-DD. */
  fecha: string;
  /** Lo ya pagado de esta cuota. */
  pagado: number;
}

/** Valor de la penalidad: el porcentaje del saldo, redondeado al peso. */
export function valorPenalidad(saldo: number, porcentaje = PORCENTAJE_PENALIDAD): number {
  return Math.max(0, Math.round((Number(saldo) || 0) * porcentaje / 100));
}

/** YYYY-MM-DD + N meses; conserva el día y, si el mes no lo tiene, cae al último día. */
export function sumarMeses(fecha: string, n: number): string {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return '';
  const idx = (m - 1) + n;
  const anio = y + Math.floor(idx / 12);
  const mes = ((idx % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** Plan en partes iguales; la última cuota absorbe el redondeo. Fechas: la primera y luego cada mes. */
export function armarPlan(valor: number, numCuotas: number, primeraFecha: string): CuotaPenalidad[] {
  const n = Math.max(1, Math.floor(numCuotas));
  const total = Math.round(valor);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    valor: i === n - 1 ? total - base * (n - 1) : base,
    fecha: sumarMeses(primeraFecha, i),
    pagado: 0,
  }));
}

export const totalPlan = (c: CuotaPenalidad[]) => c.reduce((s, x) => s + x.valor, 0);
export const totalPagado = (c: CuotaPenalidad[]) => c.reduce((s, x) => s + Math.min(x.pagado, x.valor), 0);
export const pendientePlan = (c: CuotaPenalidad[]) => Math.max(0, totalPlan(c) - totalPagado(c));
export const planCompleto = (c: CuotaPenalidad[]) => c.length > 0 && pendientePlan(c) <= 0.5;
export const cuotaCompleta = (x: CuotaPenalidad) => x.pagado >= x.valor - 0.5;
/** Primera cuota que aún no está completa (o undefined). */
export const siguienteCuota = (c: CuotaPenalidad[]) => c.find(x => !cuotaCompleta(x));

/**
 * Aplica un pago a las cuotas EN ORDEN (permite adelantar varias). Devuelve las cuotas
 * nuevas y lo que no cupo (sobrante > 0 significa que el pago excede lo pendiente).
 */
export function aplicarPagoPlan(cuotas: CuotaPenalidad[], monto: number): { cuotas: CuotaPenalidad[]; aplicado: number; sobrante: number } {
  let resto = Math.round(monto);
  const out = cuotas.map(c => ({ ...c }));
  for (const c of out) {
    if (resto <= 0) break;
    const falta = Math.max(0, c.valor - c.pagado);
    const a = Math.min(falta, resto);
    c.pagado += a;
    resto -= a;
  }
  return { cuotas: out, aplicado: Math.round(monto) - resto, sobrante: resto };
}
