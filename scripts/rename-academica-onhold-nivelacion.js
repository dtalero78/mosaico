/**
 * Renombra en ACADEMICA (solo ACADEMICA; PEOPLE no se toca — su OnHold real usa
 * PEOPLE.onHoldCount/onHoldHistory):
 *   onHoldCount   → NivelacionCount    (integer, sin cambio de tipo)
 *   onHoldHistory → NivelacionHistory  (jsonb)
 * Columnas muertas de Wix (0 / [] en las 44 filas). Idempotente.
 * Uso: node scripts/rename-academica-onhold-nivelacion.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
const RENAMES = [['onHoldCount','NivelacionCount'],['onHoldHistory','NivelacionHistory']];
const has = async (c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name=$1`,[c])).rows.length>0;
(async()=>{
  const steps=[];
  for (const [o,n] of RENAMES){
    const oo=await has(o), nn=await has(n);
    if (nn && !oo){ console.log(`= ${n} ya existe (idempotente)`); continue; }
    if (!oo){ console.log(`⚠ ${o} no existe`); continue; }
    if (oo && nn){ console.log(`⚠ existen AMBAS ${o} y ${n} — revisar`); continue; }
    steps.push([o,n]);
  }
  if(!steps.length){console.log('Nada por hacer.');await pool.end();return;}
  if(!apply){console.log('[dry-run]');steps.forEach(([o,n])=>console.log(`  ALTER TABLE "ACADEMICA" RENAME COLUMN "${o}" TO "${n}"`));console.log('(usa --apply)');await pool.end();return;}
  for(const [o,n] of steps){await pool.query(`ALTER TABLE "ACADEMICA" RENAME COLUMN "${o}" TO "${n}"`);console.log(`✓ ${o} → ${n}`);}
  const fin=await pool.query(`SELECT column_name,data_type FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name IN ('NivelacionCount','NivelacionHistory') ORDER BY column_name`);
  console.log('\nEstado final:',JSON.stringify(fin.rows));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
