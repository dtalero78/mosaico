/**
 * drop-academica-nivelacionguia.js
 * Elimina la columna muerta ACADEMICA.nivelacionGuia (heredada de pruebainter,
 * sin uso en MOSAICO tras retirar el proceso de Exámenes Internacionales).
 * Uso: node scripts/drop-academica-nivelacionguia.js [--apply]
 * Sin --apply → dry-run (solo reporta). Idempotente.
 */
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const cs = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/,'');
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

(async () => {
  const exists = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name='nivelacionGuia'`);
  if (!exists.rows.length) { console.log('✅ La columna nivelacionGuia no existe (ya limpio).'); await pool.end(); return; }
  const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM "ACADEMICA" WHERE "nivelacionGuia" IS NOT NULL`);
  console.log(`Columna nivelacionGuia existe. Filas con valor no-nulo: ${cnt.rows[0].n}`);
  if (!APPLY) { console.log('DRY-RUN. Ejecuta con --apply para eliminar.'); await pool.end(); return; }
  if (cnt.rows[0].n > 0) { console.log(`⚠️  Tiene ${cnt.rows[0].n} valores — NO se elimina por seguridad.`); await pool.end(); process.exit(1); }
  await pool.query(`ALTER TABLE "ACADEMICA" DROP COLUMN IF EXISTS "nivelacionGuia"`);
  console.log('✅ Columna nivelacionGuia eliminada.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
