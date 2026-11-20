/**
 * Columnas de auditoría de la cancelación de un agendamiento hecha por el
 * personal (Servicio › Nivelaciones › Pendientes y Talleres › Gestión usuario):
 * quién, cuándo y por qué. Nullables; las cancelaciones anteriores quedan en NULL.
 * Idempotente. Uso: node scripts/add-bookings-cancelacion-audit.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').split('?')[0], ssl: { rejectUnauthorized: false } });
(async () => {
  const sql = `ALTER TABLE "ACADEMICA_BOOKINGS"
    ADD COLUMN IF NOT EXISTS "canceladoPor" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "canceladoEn" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "motivoCancelacion" TEXT,
    ADD COLUMN IF NOT EXISTS "trasladadoAEvento" VARCHAR(255)`;
  if (!APPLY) { console.log(sql, '\n(dry-run) --apply para aplicar'); await pool.end(); return; }
  const c = await pool.connect();
  try { await c.query(`SET lock_timeout = '5s'`); await c.query(sql); console.log('✅ columnas listas'); } finally { c.release(); await pool.end(); }
})().catch(async e => { console.error('❌', e.message); await pool.end(); process.exit(1); });
