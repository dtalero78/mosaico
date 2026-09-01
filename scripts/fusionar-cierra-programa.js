/**
 * Fusiona el estado CIERRA_PROGRAMA dentro de PROCESO_DE_CIERRE.
 *
 * Los dos pasaron a llamarse "Cierre financiero" al renombrar los estados, así
 * que habrían quedado con la misma etiqueta e indistinguibles al filtrar. Se
 * conserva PROCESO_DE_CIERRE (es el que tiene datos) y CIERRA_PROGRAMA deja de
 * ofrecerse al elegir estado.
 *
 * El valor NO se borra del ENUM de PostgreSQL: quitarlo obliga a recrear el tipo
 * y a reescribir todas las columnas que lo usan, sin ganancia — basta con que la
 * aplicación deje de ofrecerlo y que los datos existentes se migren.
 *
 * Uso: node scripts/fusionar-cierra-programa.js [--apply]
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  console.log(APPLY ? '=== APLICANDO ===\n' : '=== ENSAYO (sin --apply no se escribe nada) ===\n')

  const casos = await pool.query(
    `SELECT "_id", "codigo" FROM "CASOS_ATENCION" WHERE "estado" = 'CIERRA_PROGRAMA'`)
  const hist = await pool.query(
    `SELECT COUNT(*)::int n FROM "CASOS_ESTADO_HISTORIAL"
      WHERE "estadoAnterior" = 'CIERRA_PROGRAMA' OR "estadoNuevo" = 'CIERRA_PROGRAMA'`)

  console.log(`casos en CIERRA_PROGRAMA: ${casos.rowCount}`)
  casos.rows.forEach((c) => console.log(`   ${c.codigo}`))
  console.log(`entradas de historial que lo mencionan: ${hist.rows[0].n} (se dejan como están: son la historia real)`)

  if (!casos.rowCount) {
    console.log('\nNada que migrar.')
    await pool.end()
    return
  }
  if (!APPLY) {
    console.log('\nEnsayo. Re-ejecuta con --apply para escribir.')
    await pool.end()
    return
  }

  const r = await pool.query(
    `UPDATE "CASOS_ATENCION" SET "estado" = 'PROCESO_DE_CIERRE', "_updatedDate" = NOW()
      WHERE "estado" = 'CIERRA_PROGRAMA'`)
  const quedan = await pool.query(
    `SELECT COUNT(*)::int n FROM "CASOS_ATENCION" WHERE "estado" = 'CIERRA_PROGRAMA'`)

  console.log(`\n--- verificación ---`)
  console.log(`migrados: ${r.rowCount} · quedan en CIERRA_PROGRAMA: ${quedan.rows[0].n}`)
  console.log(quedan.rows[0].n === 0 ? '\n✓ OK' : '\n✗ REVISAR')
  await pool.end()
})().catch((e) => { console.error(e.message); process.exit(1) })
