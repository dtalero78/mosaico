#!/usr/bin/env node
/**
 * Agrega a PAGOS_TITULARES las tres columnas que faltaban frente a LGS:
 *
 *   valorAplicado NUMERIC(12,2)  — lo que el pago descuenta del saldo
 *   vlrpenalidad  NUMERIC(12,2)  — el valor cobrado como penalidad
 *   penalidad     BOOLEAN        — si ese pago es una penalidad
 *
 * ⚠ La fórmula del valor aplicado NO es la de LGS. Allá `valorAplicado` se
 * llena con `valorPagado` a secas (y su backfill histórico usó
 * `valorPagado - descuento`). En MOSAICO la regla es la contraria y está
 * decidida: el descuento es una REBAJA SOBRE LA CUOTA, así que
 *
 *      valorAplicado = valorPagado + descuento
 *
 * Si la cuota es 115.000 y se le descuentan 25.000, el titular paga 90.000 y
 * la cuota queda saldada igual: contra el saldo se aplican los 115.000. Es la
 * misma `computeValorAplicar` del servicio, y la que ya usa `syncFinancieroSaldo`
 * para mantener el "Saldo a la Fecha". Backfillear con la de LGS dejaría la
 * columna contradiciendo al saldo que el titular ve en pantalla.
 *
 * `penalidad`/`vlrpenalidad` sí se traen tal cual: al marcar la casilla
 * Penalidad, el valor va a su propia columna en vez de mezclarse con el pago.
 *
 * Uso:
 *   node scripts/add-pagos-penalidad-valoraplicado.js           (ensayo)
 *   node scripts/add-pagos-penalidad-valoraplicado.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')

const COLUMNAS = [
  { nombre: 'valorAplicado', ddl: 'NUMERIC(12,2)' },
  { nombre: 'vlrpenalidad',  ddl: 'NUMERIC(12,2)' },
  { nombre: 'penalidad',     ddl: 'BOOLEAN DEFAULT false' },
]

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const existentes = new Set((await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'PAGOS_TITULARES'`
    )).rows.map(r => r.column_name))

    const faltan = COLUMNAS.filter(c => !existentes.has(c.nombre))
    console.log('Columnas:')
    for (const c of COLUMNAS) {
      console.log(`  ${c.nombre.padEnd(16)} ${existentes.has(c.nombre) ? 'ya existe' : 'se creará  ' + c.ddl}`)
    }

    // Cuántas filas quedarían con valorAplicado, y con qué valores
    const prev = (await client.query(`
      SELECT COUNT(*)::int total,
             COUNT(*) FILTER (WHERE COALESCE("descuento",0) <> 0)::int con_descuento,
             SUM(COALESCE("valorPagado",0) + COALESCE("descuento",0))::numeric suma
        FROM "PAGOS_TITULARES"`)).rows[0]
    console.log(`\nBackfill de valorAplicado (valorPagado + descuento):`)
    console.log(`  ${prev.total} pago(s); ${prev.con_descuento} con descuento distinto de cero`)
    console.log(`  suma a escribir: ${Number(prev.suma || 0).toLocaleString('es-CO')}`)

    if (!faltan.length) {
      console.log('\n✓ Las tres columnas ya existen. Nada que crear.')
      if (!APPLY) return
    }
    if (!APPLY) { console.log('\nENSAYO — nada se escribió. Agrega --apply.'); return }

    await client.query('BEGIN')
    try {
      for (const c of faltan) {
        await client.query(`ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "${c.nombre}" ${c.ddl}`)
        console.log(`  ✓ ${c.nombre}`)
      }

      // Sólo rellena lo que esté vacío: re-correrlo no pisa correcciones manuales.
      const r = await client.query(`
        UPDATE "PAGOS_TITULARES"
           SET "valorAplicado" = GREATEST(0, COALESCE("valorPagado",0) + COALESCE("descuento",0))
         WHERE "valorAplicado" IS NULL`)
      console.log(`  ✓ backfill de valorAplicado: ${r.rowCount} fila(s)`)

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }

    const fin = (await client.query(`
      SELECT COUNT(*)::int total,
             COUNT("valorAplicado")::int con_valor,
             COUNT(*) FILTER (WHERE "penalidad" IS TRUE)::int penalidades
        FROM "PAGOS_TITULARES"`)).rows[0]
    console.log(`\n✓ Aplicado. ${fin.con_valor}/${fin.total} pagos con valorAplicado · ${fin.penalidades} marcados como penalidad.`)
  } finally {
    client.release()
    await pool.end()
  }
})().catch(e => { console.error('✗', e.message); process.exit(1) })
