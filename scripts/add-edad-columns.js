/**
 * Agrega la columna `edad` (INTEGER) a ACADEMICA y PEOPLE.
 *
 * El seed mínimo de mosaico-db no la creó y el motor la escribe en varios flujos
 * (p.ej. POST /api/nuevo-usuario/[id] — "Completar registro" reventaba con
 * "Database error" por `column "edad" does not exist`).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Aplicado en mosaico-db el 2026-07-22.
 *
 * Uso: node scripts/add-edad-columns.js
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  for (const t of ['ACADEMICA', 'PEOPLE']) {
    await pool.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "edad" INTEGER`);
    console.log(`✓ ${t}.edad OK`);
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
