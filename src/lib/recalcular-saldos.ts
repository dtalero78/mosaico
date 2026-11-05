import 'server-only';
import type { PoolClient } from 'pg';
import { asignarPagos } from '@/lib/cuotas-pagos';

/**
 * Recalcula los saldos de un titular después de ajustar un pago YA VALIDADO
 * (Recaudos › Gestión › Ajustes). Misma regla de MOSAICO que el resto del módulo:
 *
 *   - Lo que un pago aplica contra el saldo = valorPagado + descuento (el
 *     descuento es una REBAJA sobre la cuota, así que SUMA — ver
 *     computeValorAplicar en pagos-titulares.service).
 *   - PAGOS_TITULARES.saldo (validados) = saldo corrido del contrato después de
 *     cada pago: totalPlan − Σ(valorPagado + descuento), en orden fechaPago +
 *     _createdDate. PAGOS_TITULARES.valorAplicado = valorPagado + descuento.
 *   - FINANCIEROS.saldo ("Saldo a la Fecha") y cuotasPagadas, igual que
 *     syncFinancieroSaldo: sólo cuentan los pagos VALIDADOS; cuotasPagadas =
 *     validados con numCuota > 0.
 *
 * Los pagos pendientes no se tocan. Corre dentro de la transacción del caller.
 * (No reutiliza syncFinancieroSaldo: ésa usa su propia conexión y es best-effort;
 * aquí el recálculo debe ser atómico con el UPDATE del ajuste.)
 */
function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function recalcularSaldosTitular(
  client: PoolClient,
  idPeople: string,
): Promise<{ contrato: string | null; saldo: string | null }> {
  const per = (await client.query(`SELECT "contrato" FROM "PEOPLE" WHERE "_id" = $1`, [idPeople])).rows[0];
  const contrato: string | null = per?.contrato ?? null;
  if (!contrato) return { contrato: null, saldo: null };
  const fin = (await client.query(
    `SELECT "_id", "totalPlan", "valorCuota", "numeroCuotas", "pagoInscripcion" FROM "FINANCIEROS" WHERE "contrato" = $1 LIMIT 1`, [contrato])).rows[0];
  if (!fin) return { contrato, saldo: null };
  const totalPlan = num(fin.totalPlan);

  const pagos = (await client.query(
    `SELECT "_id", "numCuota", "fechaPago", "_createdDate", "valorPagado", "descuento", "saldo", "valorAplicado", "inscripcion"
       FROM "PAGOS_TITULARES" WHERE "idPeople" = $1 AND "validado" = true`, [idPeople])).rows;
  const key = (p: any) => (p.fechaPago ? new Date(p.fechaPago).toISOString().slice(0, 10) : '') +
    (p._createdDate ? new Date(p._createdDate).toISOString() : '');
  pagos.sort((a, b) => key(a).localeCompare(key(b)));

  let running = totalPlan;
  let pagado = 0;
  // Cuotas COMPLETAS (abonos sumados), no filas de pago — igual que syncFinancieroSaldo.
  const cuotasPagadas = asignarPagos({
    inscripcion: num(fin.pagoInscripcion),
    valorCuota: num(fin.valorCuota),
    numeroCuotas: parseInt(String(fin.numeroCuotas ?? 0), 10) || 0,
    pagos,
  }).cuotasCompletas;
  for (const p of pagos) {
    const aplicado = num(p.valorPagado) + num(p.descuento);
    pagado += aplicado;
    running = Math.max(0, running - aplicado);
    const saldo = Number(running.toFixed(2));
    const valorAplicado = Number(aplicado.toFixed(2));
    if (num(p.saldo) !== saldo || num(p.valorAplicado) !== valorAplicado) {
      await client.query(
        `UPDATE "PAGOS_TITULARES" SET "saldo" = $2, "valorAplicado" = $3, "_updatedDate" = NOW() WHERE "_id" = $1`,
        [p._id, saldo, valorAplicado]);
    }
  }
  // Entero sin decimales: la ficha parsea el saldo con parseCurrency (punto = miles).
  const saldo = String(Math.round(Math.max(0, totalPlan - pagado)));
  await client.query(
    `UPDATE "FINANCIEROS" SET "saldo" = $2, "cuotasPagadas" = $3, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [fin._id, saldo, cuotasPagadas]);
  return { contrato, saldo };
}
