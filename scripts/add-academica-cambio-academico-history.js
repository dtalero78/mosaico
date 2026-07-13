/**
 * MOSAICO — "Cambio Académico" (mover beneficiario de campaña/curso/salón).
 *
 * Agrega a ACADEMICA:
 *   - "cambioAcademicoHistory" JSONB DEFAULT '[]' → auditoría de cada cambio
 *     de curso/campaña/salón (fecha, motivo, origen, destino, bookings, actor).
 *
 * Uso: node scripts/add-academica-cambio-academico-history.js
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
    await pool.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "cambioAcademicoHistory" JSONB DEFAULT '[]'::jsonb`);
    await pool.query(`UPDATE "ACADEMICA" SET "cambioAcademicoHistory" = '[]'::jsonb WHERE "cambioAcademicoHistory" IS NULL`);
    const c = await pool.query(`SELECT COUNT(*)::int n FROM "ACADEMICA"`);
    console.log(`✅ ACADEMICA."cambioAcademicoHistory" JSONB DEFAULT '[]' (filas: ${c.rows[0].n})`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
