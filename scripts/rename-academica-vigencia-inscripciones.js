/**
 * Renombra ACADEMICA."vigencia" (columna muerta, heredada de Wix, siempre vacía y
 * sin uso real — la vigencia real vive y se actualiza en PEOPLE) → "inscripciones".
 * Idempotente. Requiere que el código ya NO lea ACADEMICA.vigencia (ajustado en
 * academica.repository.ts: findByAnyId y findProfileById).
 * Uso: node scripts/rename-academica-vigencia-inscripciones.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
(async () => {
  const has = async (c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name=$1`,[c])).rows.length>0;
  const hasVig = await has('vigencia'), hasIns = await has('inscripciones');
  if (hasIns && !hasVig) { console.log('= ya renombrada (inscripciones existe, vigencia no). idempotente'); await pool.end(); return; }
  if (!hasVig) { console.log('⚠ ACADEMICA no tiene columna vigencia'); await pool.end(); return; }
  if (hasIns && hasVig) { console.log('⚠ existen AMBAS (vigencia e inscripciones) — revisar manualmente'); await pool.end(); return; }
  const sql = `ALTER TABLE "ACADEMICA" RENAME COLUMN "vigencia" TO "inscripciones"`;
  if (!apply) { console.log('[dry-run]', sql, '\n(usa --apply)'); await pool.end(); return; }
  await pool.query(sql);
  console.log('✓ renombrada ACADEMICA.vigencia → inscripciones');
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
