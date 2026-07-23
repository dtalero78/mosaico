/**
 * Agrega a PEOPLE las columnas del marcador "Contrato Para Aprobación":
 *   listoAprobacion    TIMESTAMPTZ — cuándo el comercial marcó el contrato como LISTO
 *   listoAprobacionPor VARCHAR    — quién lo marcó (email de la sesión)
 * El Centro de Aprobación filtra por defecto los contratos en LISTO.
 * Idempotente. Uso: node scripts/add-listo-aprobacion-columns.js
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "listoAprobacion" TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "listoAprobacionPor" VARCHAR(255)`);
  console.log('✓ PEOPLE.listoAprobacion + listoAprobacionPor OK');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
