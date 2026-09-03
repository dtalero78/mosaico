#!/usr/bin/env node
/**
 * Registra en PEOPLE cuándo se hicieron las acciones de cierre del contrato.
 *
 * El checklist "Antes de cerrar" mostraba "Pendiente" en cosas que sí se habían
 * hecho, porque tres de sus cuatro marcas vivían sólo en el estado del navegador
 * (useState) y volvían a cero en cada carga de la página. Ni el envío de la
 * solicitud de firma ni el del PDF dejaban rastro en la base, así que al abrir el
 * contrato el dato no existía. Estas tres columnas lo hacen persistente.
 *
 * Nullable: los contratos existentes quedan en NULL (no se puede reconstruir
 * hacia atrás — el dato nunca se guardó) y se van llenando a partir de ahora.
 *
 * Uso:
 *   node scripts/add-people-envios-contrato.js           (ensayo)
 *   node scripts/add-people-envios-contrato.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const COLS = [
  ['firmaSolicitadaEn',  'TIMESTAMPTZ', 'cuándo se envió por WhatsApp el enlace para firmar'],
  ['pdfEnviadoEn',       'TIMESTAMPTZ', 'cuándo se envió el PDF del contrato por WhatsApp'],
  ['contratoImpresoEn',  'TIMESTAMPTZ', 'cuándo se imprimió el contrato desde el panel'],
]

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'PEOPLE' AND column_name = ANY($1)`,
      [COLS.map(c => c[0])]
    )
    const existentes = new Set(rows.map(r => r.column_name))

    console.log('Columnas en PEOPLE:')
    for (const [name, tipo, desc] of COLS) {
      console.log(`  ${existentes.has(name) ? '✓ ya existe' : '+ se creará'}  "${name}" ${tipo}`)
      console.log(`      ${desc}`)
    }

    const faltan = COLS.filter(c => !existentes.has(c[0]))
    if (!faltan.length) { console.log('\n✓ Nada que hacer.'); return }
    if (!APPLY) { console.log(`\nENSAYO — ${faltan.length} columna(s) por crear. Agrega --apply.`); return }

    for (const [name, tipo] of faltan) {
      await client.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "${name}" ${tipo}`)
      console.log(`  ✓ creada "${name}"`)
    }
    console.log('\n✓ Aplicado.')
  } catch (e) {
    console.error('ERROR:', e.message); process.exitCode = 1
  } finally {
    client.release(); await pool.end()
  }
})()
