#!/usr/bin/env node
/**
 * Corrige el ÚNICO pago de la base capturado con el descuento aplicado de más.
 *
 * MELISA ROMAN · contrato 01-M5-2815-26 · cuota #1
 *   Hoy:  pagó 115.000 Y ADEMÁS descuento 25.000 → aplicó 140.000 contra el
 *         saldo, cuando la cuota es de 115.000. Sobran 25.000.
 *
 * Con la regla de negocio (el descuento es una rebaja SOBRE LA CUOTA), las dos
 * lecturas posibles dejan el MISMO saldo — 920.000 — pero registran cosas
 * distintas, y eso lo decide Recaudos:
 *
 *   --con-descuento   pagó 90.000 + descuento 25.000   (sí se le dio el descuento)
 *   --sin-descuento   pagó 115.000 + descuento 0       (no hubo descuento; fue error)
 *
 * Uso:
 *   node scripts/fix-pago-descuento-melisa.js --con-descuento          (ensayo)
 *   node scripts/fix-pago-descuento-melisa.js --con-descuento --apply
 *
 * Idempotente: si el pago ya quedó con aplicado = cuota, no toca nada.
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const CONTRATO = '01-M5-2815-26'
const NUM_CUOTA = 1
const APPLY = process.argv.includes('--apply')
const CON = process.argv.includes('--con-descuento')
const SIN = process.argv.includes('--sin-descuento')
const n = v => Number(v) || 0
const fmt = v => '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v)

if (CON === SIN) {
  console.error('Elige exactamente una: --con-descuento  |  --sin-descuento')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const { rows: [pago] } = await client.query(
      `SELECT pt."_id", pt."idPeople", pt."valorPagado", pt."descuento", pt."valorCuota", pt."validado"
         FROM "PAGOS_TITULARES" pt
         JOIN "PEOPLE" pe ON pe."_id" = pt."idPeople"
        WHERE pe."contrato" = $1 AND pt."numCuota" = $2`, [CONTRATO, NUM_CUOTA])
    if (!pago) { console.log('No encontré el pago. Nada que hacer.'); return }

    const { rows: [fin] } = await client.query(
      `SELECT "totalPlan", "valorCuota", "saldo" FROM "FINANCIEROS"
        WHERE "contrato" = $1 ORDER BY "_createdDate" DESC LIMIT 1`, [CONTRATO])

    const cuota = n(fin?.valorCuota) || n(pago.valorCuota)
    const aplicaHoy = n(pago.valorPagado) + n(pago.descuento)

    console.log(`Contrato ${CONTRATO} · cuota #${NUM_CUOTA} · valor cuota ${fmt(cuota)}`)
    console.log(`  hoy:  pagado ${fmt(n(pago.valorPagado))} + descuento ${fmt(n(pago.descuento))} = aplica ${fmt(aplicaHoy)}`)
    console.log(`  Saldo a la Fecha actual: ${fmt(n(fin?.saldo))}\n`)

    if (Math.abs(aplicaHoy - cuota) < 1) {
      console.log('✓ Ya está correcto (aplicado = cuota). No se toca nada.')
      return
    }

    const nuevoPagado = CON ? Math.max(0, cuota - n(pago.descuento)) : cuota
    const nuevoDesc   = CON ? n(pago.descuento) : 0
    const nuevoAplica = nuevoPagado + nuevoDesc

    console.log(`  ${CON ? '--con-descuento' : '--sin-descuento'}:`)
    console.log(`     pagado ${fmt(n(pago.valorPagado))} → ${fmt(nuevoPagado)}`)
    console.log(`     descuento ${fmt(n(pago.descuento))} → ${fmt(nuevoDesc)}`)
    console.log(`     aplica ${fmt(aplicaHoy)} → ${fmt(nuevoAplica)}  (= la cuota)`)

    // Saldo del contrato recalculado igual que syncFinancieroSaldo
    const { rows: [s] } = await client.query(
      `SELECT COALESCE(SUM(COALESCE("valorPagado",0) + COALESCE("descuento",0)),0)::text total
         FROM "PAGOS_TITULARES" WHERE "idPeople" = $1 AND "validado" = true AND "_id" <> $2`,
      [pago.idPeople, pago._id])
    const saldoNuevo = Math.max(0, n(fin?.totalPlan) - (n(s.total) + nuevoAplica))
    console.log(`     Saldo a la Fecha ${fmt(n(fin?.saldo))} → ${fmt(saldoNuevo)}\n`)

    if (!APPLY) { console.log('ENSAYO — nada se escribió. Agrega --apply para aplicar.'); return }

    await client.query('BEGIN')
    await client.query(
      `UPDATE "PAGOS_TITULARES" SET "valorPagado" = $1, "descuento" = $2, "_updatedDate" = NOW()
        WHERE "_id" = $3`, [nuevoPagado, nuevoDesc, pago._id])
    await client.query(
      `UPDATE "FINANCIEROS" SET "saldo" = $1 WHERE "contrato" = $2`,
      [String(Math.round(saldoNuevo)), CONTRATO])
    await client.query('COMMIT')
    console.log('✓ Aplicado.')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('ERROR:', e.message); process.exitCode = 1
  } finally {
    client.release(); await pool.end()
  }
})()
