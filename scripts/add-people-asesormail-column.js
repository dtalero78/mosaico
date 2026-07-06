/**
 * Agrega PEOPLE."asesorMail" (correo del asesor comercial), mostrado en la
 * plantilla del contrato ({{asesormail}}) junto a "Asesor comercial: {{asesor}}".
 * Idempotente. Uso: node scripts/add-people-asesormail-column.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const sql = `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "asesorMail" VARCHAR(255)`;
  if (!apply) { console.log('[dry-run]', sql, '\n(usa --apply para ejecutar)'); await pool.end(); return; }
  await pool.query(sql);
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='PEOPLE' AND column_name='asesorMail'`);
  console.log('OK — columna asesorMail:', c.rows.length ? 'existe' : 'NO existe');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
