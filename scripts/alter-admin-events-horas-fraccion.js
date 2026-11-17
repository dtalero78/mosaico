/**
 * ADMIN_EVENTS.horas: de INTEGER (1..12) a DOUBLE PRECISION (0.5..12), para poder
 * crear eventos administrativos de 30 min, 1 h 30 min, etc.
 *
 * DOUBLE PRECISION y no NUMERIC: el driver `pg` devuelve NUMERIC como texto y
 * `horas` se usa como número en varios sitios (ventanas, sumas, pantallas); con
 * float8 llega como number, y los múltiplos de 0.5 son exactos.
 *
 * Idempotente. Ensayo por defecto; `--apply` para escribir.
 *   node scripts/alter-admin-events-horas-fraccion.js [--apply]
 */
require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')

;(async () => {
  const url = process.env.DATABASE_URL.replace(/[?]sslmode=[^&]*/, '')
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const t = await c.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name='ADMIN_EVENTS' AND column_name='horas'`)
  const tipo = t.rows[0]?.data_type
  console.log('Tipo actual de horas:', tipo)
  const cks = await c.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = '"ADMIN_EVENTS"'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%horas%'`)
  console.log('CHECKs sobre horas:', cks.rows.map(r => r.conname))

  if (!APPLY) { console.log('Ensayo: nada escrito. Use --apply.'); await c.end(); return }

  await c.query('BEGIN')
  await c.query(`SET LOCAL lock_timeout = '5s'`)
  for (const r of cks.rows) await c.query(`ALTER TABLE "ADMIN_EVENTS" DROP CONSTRAINT "${r.conname}"`)
  if (tipo !== 'double precision') await c.query(`ALTER TABLE "ADMIN_EVENTS" ALTER COLUMN "horas" TYPE DOUBLE PRECISION`)
  await c.query(`ALTER TABLE "ADMIN_EVENTS" ADD CONSTRAINT "ADMIN_EVENTS_horas_check"
                 CHECK ("horas" >= 0.5 AND "horas" <= 12 AND ("horas" * 2) = FLOOR("horas" * 2))`)
  await c.query('COMMIT')
  console.log('Listo: horas ahora admite múltiplos de 0.5 entre 0.5 y 12.')
  await c.end()
})().catch(e => { console.error(e); process.exit(1) })
