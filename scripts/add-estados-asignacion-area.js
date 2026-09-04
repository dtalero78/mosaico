#!/usr/bin/env node
/**
 * Agrega al ENUM `estado_caso` los tres estados genéricos con los que el botón
 * "Asignar" de Casos de Atención deriva un caso a un área.
 *
 * Hasta ahora cada área tenía sólo estados FINOS (Cambio de Nivel, Solicitud
 * Congelamiento, Cierre financiero, Envío Pre-jurídico). El modal de Asignar
 * pregunta por ÁREA, no por el trámite concreto, así que hace falta un estado
 * que signifique exactamente "esto es de esta área" sin comprometerse con el
 * detalle — el detalle se sigue pudiendo precisar desde la ficha del alumno,
 * donde el desplegable ofrece todos.
 *
 * Se agregan y no se reusa uno de los finos porque cada uno de ésos afirma algo
 * concreto sobre el alumno: marcar "Cambio de Nivel" cuando sólo se sabe que el
 * caso es del área académica sería registrar un trámite que nadie pidió.
 *
 * Uso:
 *   node scripts/add-estados-asignacion-area.js           (ensayo)
 *   node scripts/add-estados-asignacion-area.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const VALORES = [
  'REMITIDO_A_SERVICIO_ACADEMICO',
  'REMITIDO_A_NIVELACION',
  'REMITIDO_A_FINANZAS',
]
const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const leer = async () => (await client.query(
      `SELECT unnest(enum_range(NULL::estado_caso))::text AS v`)).rows.map(r => r.v)

    const actuales = await leer()
    console.log(`Estados actuales del ENUM estado_caso (${actuales.length}):`)
    actuales.forEach(v => console.log(`  · ${v}`))

    const faltan = VALORES.filter(v => !actuales.includes(v))
    if (!faltan.length) {
      console.log('\n✓ Los tres ya existen. Nada que hacer.')
      return
    }
    console.log('\nSe agregarán:')
    faltan.forEach(v => console.log(`  + ${v}`))

    if (!APPLY) { console.log('\nENSAYO — nada se escribió. Agrega --apply.'); return }

    // ADD VALUE no admite transacción envolvente; se emiten sueltos.
    // IF NOT EXISTS los hace repetibles sin error.
    for (const v of faltan) {
      await client.query(`ALTER TYPE estado_caso ADD VALUE IF NOT EXISTS '${v}'`)
      console.log(`  ✓ ${v}`)
    }

    const fin = await leer()
    console.log(`\n✓ Aplicado. El ENUM queda con ${fin.length} valores:`)
    fin.forEach(v => console.log(`  · ${v}`))
  } finally {
    client.release()
    await pool.end()
  }
})().catch(e => { console.error('✗', e.message); process.exit(1) })
