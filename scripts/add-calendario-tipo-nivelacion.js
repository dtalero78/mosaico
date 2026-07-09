/**
 * add-calendario-tipo-nivelacion.js
 * Amplía el CHECK constraint CALENDARIO_tipo_check para permitir tipo='NIVELACION'
 * (además de SESSION/CLUB/WELCOME/COMPLEMENTARIA). Sin esto, crear un evento de
 * Nivelación viola el constraint y falla con "Database error".
 * Uso: node scripts/add-calendario-tipo-nivelacion.js [--apply]
 * Sin --apply → dry-run. Idempotente (DROP IF EXISTS + ADD con la lista ampliada).
 */
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const cs = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/,'');
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
const ALLOWED = ['SESSION','CLUB','WELCOME','COMPLEMENTARIA','NIVELACION'];

(async () => {
  const cur = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid='"CALENDARIO"'::regclass AND conname='CALENDARIO_tipo_check'`);
  console.log('Constraint actual:', cur.rows[0]?.def || '(ninguno)');
  if (cur.rows[0]?.def?.includes("'NIVELACION'")) { console.log('✅ Ya incluye NIVELACION.'); await pool.end(); return; }
  const list = ALLOWED.map(v => `'${v}'`).join(', ');
  const sql = `ALTER TABLE "CALENDARIO" DROP CONSTRAINT IF EXISTS "CALENDARIO_tipo_check";
               ALTER TABLE "CALENDARIO" ADD CONSTRAINT "CALENDARIO_tipo_check" CHECK ("tipo"::text = ANY (ARRAY[${list}]::text[]));`;
  if (!APPLY) { console.log('DRY-RUN. SQL a aplicar:\n' + sql); await pool.end(); return; }
  await pool.query(sql);
  const nw = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid='"CALENDARIO"'::regclass AND conname='CALENDARIO_tipo_check'`);
  console.log('✅ Constraint nuevo:', nw.rows[0]?.def);
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
