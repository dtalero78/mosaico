/**
 * MOSAICO — columna CASOS_ATENCION."noContinua".
 *
 * Al cerrar un caso se puede marcar "Usuario NO continúa con el curso". Es un
 * dato del cierre (por qué terminó el caso), no una baja: no inactiva al alumno
 * ni libera su cupo. Se guarda como columna para poder filtrarlo y contarlo; el
 * texto también queda en la bitácora del caso.
 *
 * Idempotente. Ensayo por defecto; --apply para escribir. Con lock_timeout para
 * no encolar a producción detrás de un ALTER.
 *   node scripts/add-casos-no-continua.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });
  try {
    const existe = (await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='CASOS_ATENCION' AND column_name='noContinua'`)).rowCount > 0;
    if (existe) { console.log('La columna ya existe. Nada que hacer.'); return; }
    if (!APPLY) { console.log('Ensayo: se agregaría CASOS_ATENCION."noContinua" BOOLEAN NOT NULL DEFAULT false. Usa --apply.'); return; }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL lock_timeout = '5s'`);
      await c.query(`ALTER TABLE "CASOS_ATENCION" ADD COLUMN IF NOT EXISTS "noContinua" BOOLEAN NOT NULL DEFAULT false`);
      await c.query('COMMIT');
      console.log('✓ Columna CASOS_ATENCION."noContinua" creada.');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } finally { await pool.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
