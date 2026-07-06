/**
 * Agrega a PEOPLE columnas que el detalle de contrato (edición/guardado) y el
 * filler de la plantilla usan pero que el seed mínimo de mosaico-db no creó:
 *   - "observacionesContrato" TEXT          ({{observaciones}} + campo editable)
 *   - "medioPago"             VARCHAR(100)   (medio de pago del titular)
 * Sin estas, "Guardar Cambios" en /dashboard/comercial/contrato/[id] fallaba con
 * 'column "..." of relation "PEOPLE" does not exist'.
 * Idempotente. Uso: node scripts/add-people-observaciones-column.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const stmts = [
  `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "observacionesContrato" TEXT`,
  `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "medioPago" VARCHAR(100)`,
];
(async () => {
  if (!apply) { stmts.forEach(s => console.log('[dry-run]', s)); await pool.end(); return; }
  for (const s of stmts) await pool.query(s);
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='PEOPLE' AND column_name IN ('observacionesContrato','medioPago') ORDER BY column_name`);
  console.log('OK — columnas:', c.rows.map(x => x.column_name).join(', '));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
