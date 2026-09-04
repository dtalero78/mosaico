#!/usr/bin/env node
/**
 * Agrega el estado REMITIDO_A_COORDINACION al ENUM `estado_caso`.
 *
 * Es el estado con el que Servicio deriva un caso al Coordinador Académico:
 * cierra el caso para Servicio y lo manda a la pestaña "Coordinador", igual que
 * hoy hacen los estados de Académicos y Financieros.
 *
 * Va al ENUM y no a una tabla porque los otros ocho estados viven ahí: el tipo
 * es lo que garantiza que no se guarde un estado inventado.
 *
 * Uso:
 *   node scripts/add-estado-remitido-coordinacion.js           (ensayo)
 *   node scripts/add-estado-remitido-coordinacion.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const VALOR = 'REMITIDO_A_COORDINACION'
const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT unnest(enum_range(NULL::estado_caso))::text AS v`)
    const actuales = rows.map(r => r.v)
    console.log('Estados actuales del ENUM estado_caso:')
    actuales.forEach(v => console.log(`  · ${v}`))

    if (actuales.includes(VALOR)) {
      console.log(`\n✓ "${VALOR}" ya existe. Nada que hacer.`)
      return
    }
    console.log(`\n+ se agregará: ${VALOR}`)

    if (!APPLY) { console.log('\nENSAYO — nada se escribió. Agrega --apply.'); return }

    // ADD VALUE no admite transacción envolvente en algunas versiones; se emite
    // suelto. IF NOT EXISTS lo hace repetible sin error.
    await client.query(`ALTER TYPE estado_caso ADD VALUE IF NOT EXISTS '${VALOR}'`)

    const fin = (await client.query(
      `SELECT unnest(enum_range(NULL::estado_caso))::text AS v`)).rows.map(r => r.v)
    console.log(`\n✓ Aplicado. El ENUM queda con ${fin.length} valores:`)
    fin.forEach(v => console.log(`  · ${v}${v === VALOR ? '  ← nuevo' : ''}`))
  } catch (e) {
    console.error('ERROR:', e.message); process.exitCode = 1
  } finally {
    client.release(); await pool.end()
  }
})()
