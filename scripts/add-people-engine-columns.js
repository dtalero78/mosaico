/**
 * MOSAICO — agrega a PEOPLE columnas que el motor (LGS) referencia y que el seed
 * mínimo de mosaico-db no creó. Sin ellas, findProfileById (página /student/[id])
 * lanza "column does not exist" → la página devuelve 404.
 *
 *   suspenddata   JSONB    (auditoría de suspensión administrativa)
 *   suspendcount  INTEGER  (contador de suspensiones)
 *   documentacion JSONB    (array de documentos del titular/beneficiario)
 *
 * Uso: node scripts/add-people-engine-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "suspenddata" JSONB`);
    console.log('  ✓ PEOPLE."suspenddata" JSONB');
    await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "suspendcount" INTEGER DEFAULT 0`);
    console.log('  ✓ PEOPLE."suspendcount" INTEGER DEFAULT 0');
    await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "documentacion" JSONB`);
    console.log('  ✓ PEOPLE."documentacion" JSONB');
    console.log('✅ Columnas del motor agregadas a PEOPLE.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
