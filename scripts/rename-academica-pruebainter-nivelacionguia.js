/**
 * Renombra ACADEMICA."pruebainter" → "nivelacionGuia" (varchar, vacía en mosaico-db;
 * el feature Exam. Intern. no existe en MOSAICO). Idempotente.
 * Uso: node scripts/rename-academica-pruebainter-nivelacionguia.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
const has = async (c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name=$1`,[c])).rows.length>0;
(async()=>{
  const o=await has('pruebainter'), n=await has('nivelacionGuia');
  if (n && !o){ console.log('= ya renombrada (nivelacionGuia existe). idempotente'); await pool.end(); return; }
  if (!o){ console.log('⚠ pruebainter no existe'); await pool.end(); return; }
  if (o && n){ console.log('⚠ existen AMBAS — revisar'); await pool.end(); return; }
  const sql=`ALTER TABLE "ACADEMICA" RENAME COLUMN "pruebainter" TO "nivelacionGuia"`;
  if(!apply){console.log('[dry-run]',sql,'\n(usa --apply)');await pool.end();return;}
  await pool.query(sql);console.log('✓',sql);await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
