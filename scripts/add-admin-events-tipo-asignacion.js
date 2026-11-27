/**
 * Amplía el CHECK de ADMIN_EVENTS.tipo con 'ASIGNACION' (horas administrativas
 * asignadas por Académico, que nacen registradas). Reescribe el CHECK entero:
 * debe listar TODOS los tipos vigentes.
 * Uso: node scripts/add-admin-events-tipo-asignacion.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const TIPOS = ['TRAINING', 'SUPPORT', 'OBSERVATION', 'MEETING', 'DEVELOPMENT', 'ASIGNACION'];
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const c = await pool.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='ADMIN_EVENTS_tipo_check'`);
  console.log('Actual:', c.rows[0]?.d);
  if (c.rows[0]?.d?.includes("'ASIGNACION'")) { console.log('Ya incluye ASIGNACION.'); return pool.end(); }
  const sql = `ALTER TABLE "ADMIN_EVENTS" DROP CONSTRAINT IF EXISTS "ADMIN_EVENTS_tipo_check";
    ALTER TABLE "ADMIN_EVENTS" ADD CONSTRAINT "ADMIN_EVENTS_tipo_check" CHECK ("tipo" IN (${TIPOS.map(t => `'${t}'`).join(',')}))`;
  if (!APPLY) { console.log('[dry-run]', sql); return pool.end(); }
  await pool.query('BEGIN'); await pool.query("SET LOCAL lock_timeout = '5s'");
  await pool.query(sql); await pool.query('COMMIT');
  console.log('Aplicado.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
