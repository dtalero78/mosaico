#!/usr/bin/env node
/**
 * Separa el ÁREA del ESTADO en los Casos de Atención.
 *
 * Hasta ahora un solo campo `estado` decía a la vez a qué bandeja pertenece el
 * caso y en qué punto va su gestión. Eso servía mientras cada área tuviera un
 * estado y sólo uno, pero ya no: un caso asignado a Nivelaciones puede estar
 * "en gestión" o "agendado" y en ambos sigue siendo de Nivelaciones. Con un
 * único campo, marcarlo "en gestión" borraría a qué área se le asignó.
 *
 * Así que el área pasa a una columna propia:
 *   area = NULL          → sin asignar, vive en la bandeja de Casos
 *   area = ACADEMICOS…   → asignado; la bandeja lo muestra mientras su estado no cierre
 *
 * Y se agregan los tres sub-estados que no existían. Los otros que pide el
 * flujo ya están en el ENUM y se reusan:
 *   Curso Cambiado     → PROPUESTA_DE_CAMBIO
 *   Derivado Finanzas  → REMITIDO_A_FINANZAS
 *   En Proceso Cierre  → PROCESO_DE_CIERRE
 *
 * El backfill deriva el área de los estados de derivación que ya estuvieran
 * puestos; los abiertos y los cerrados quedan sin área, que es lo correcto.
 *
 * Uso:
 *   node scripts/add-casos-area-y-subestados.js           (ensayo)
 *   node scripts/add-casos-area-y-subestados.js --apply
 */
require('dotenv').config({ path: '.env.local' })
const { Pool } = require('pg')

const ESTADOS_NUEVOS = ['SALON_CAMBIADO', 'HOLD_ACTIVADO', 'NIVELACION_AGENDADA']

// De qué área es cada estado de derivación ya existente, para el backfill.
const AREA_DE_ESTADO = {
  REMITIDO_A_SERVICIO_ACADEMICO: 'ACADEMICOS',
  REMITIDO_A_ACADEMICA: 'ACADEMICOS',
  PROGRAMA_CONGELADO: 'ACADEMICOS',
  REMITIDO_A_NIVELACION: 'NIVELACIONES',
  REMITIDO_A_COORDINACION: 'COORDINADOR',
  PROPUESTA_DE_CAMBIO: 'COORDINADOR',
  REMITIDO_A_FINANZAS: 'FINANCIEROS',
  PROCESO_DE_CIERRE: 'FINANCIEROS',
  CIERRA_PROGRAMA: 'FINANCIEROS',
  PRE_JURIDICO: 'FINANCIEROS',
}

const APPLY = process.argv.includes('--apply')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false },
})

;(async () => {
  const client = await pool.connect()
  try {
    const enumActual = async () => (await client.query(
      `SELECT unnest(enum_range(NULL::estado_caso))::text AS v`)).rows.map(r => r.v)

    const tieneArea = (await client.query(
      `SELECT COUNT(*)::int n FROM information_schema.columns
        WHERE table_name = 'CASOS_ATENCION' AND column_name = 'area'`)).rows[0].n > 0

    const actuales = await enumActual()
    const faltan = ESTADOS_NUEVOS.filter(v => !actuales.includes(v))

    console.log(`Columna "area": ${tieneArea ? 'ya existe' : 'se creará'}`)
    console.log(`Estados por agregar: ${faltan.length ? faltan.join(', ') : '(ninguno)'}`)

    // Qué se backfillearía
    const porEstado = (await client.query(
      `SELECT "estado"::text e, COUNT(*)::int n FROM "CASOS_ATENCION" GROUP BY 1 ORDER BY 2 DESC`)).rows
    console.log('\nBackfill del área a partir del estado actual:')
    let conArea = 0
    for (const r of porEstado) {
      const area = AREA_DE_ESTADO[r.e]
      console.log(`  ${String(r.n).padStart(3)}  ${r.e.padEnd(30)} → ${area || '(sin área)'}`)
      if (area) conArea += r.n
    }
    console.log(`  ${conArea} caso(s) quedarían con área; el resto sin ella.`)

    if (!tieneArea && !faltan.length && !conArea) {
      console.log('\n✓ Nada que hacer.')
      return
    }
    if (!APPLY) { console.log('\nENSAYO — nada se escribió. Agrega --apply.'); return }

    // 1) ENUM: ADD VALUE no admite transacción envolvente, va suelto e idempotente
    for (const v of faltan) {
      await client.query(`ALTER TYPE estado_caso ADD VALUE IF NOT EXISTS '${v}'`)
      console.log(`  ✓ estado ${v}`)
    }

    // 2) Columna + backfill, en una transacción
    await client.query('BEGIN')
    try {
      await client.query(`ALTER TABLE "CASOS_ATENCION" ADD COLUMN IF NOT EXISTS "area" VARCHAR(20)`)
      console.log('  ✓ columna area')

      let n = 0
      for (const [estado, area] of Object.entries(AREA_DE_ESTADO)) {
        const r = await client.query(
          `UPDATE "CASOS_ATENCION" SET "area" = $1
            WHERE "estado"::text = $2 AND "area" IS NULL`, [area, estado])
        if (r.rowCount) { console.log(`  ✓ ${r.rowCount} caso(s) ${estado} → ${area}`); n += r.rowCount }
      }
      if (!n) console.log('  · ningún caso requería backfill de área')

      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_casos_area ON "CASOS_ATENCION"("area") WHERE "area" IS NOT NULL`)
      console.log('  ✓ índice sobre area')
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }

    const fin = await enumActual()
    const dist = (await client.query(
      `SELECT COALESCE("area",'(sin área)') a, COUNT(*)::int n FROM "CASOS_ATENCION" GROUP BY 1 ORDER BY 2 DESC`)).rows
    console.log(`\n✓ Aplicado. ENUM con ${fin.length} valores. Casos por área:`)
    dist.forEach(r => console.log(`  ${String(r.n).padStart(3)}  ${r.a}`))
  } finally {
    client.release()
    await pool.end()
  }
})().catch(e => { console.error('✗', e.message); process.exit(1) })
