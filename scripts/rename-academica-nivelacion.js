/**
 * Renombra en ACADEMICA (solo ACADEMICA; PEOPLE no se toca):
 *   inscripciones        → nivelacion            (boolean, sin cambio de tipo)
 *   apruebaInscripsion   → aprobadoNivelacion    (boolean)
 *   detalleInscripcion   → detalleNivelacion     (jsonb)
 * Idempotente. Uso: node scripts/rename-academica-nivelacion.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
const RENAMES = [['inscripciones','nivelacion'],['apruebaInscripsion','aprobadoNivelacion'],['detalleInscripcion','detalleNivelacion']];
const has = async (c) => (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name=$1`,[c])).rows.length>0;
(async()=>{
  const steps=[];
  for (const [oldN,newN] of RENAMES){
    const o=await has(oldN), n=await has(newN);
    if (n && !o) { console.log(`= ${newN} ya existe (idempotente)`); continue; }
    if (!o) { console.log(`⚠ ${oldN} no existe`); continue; }
    if (o && n) { console.log(`⚠ existen AMBAS ${oldN} y ${newN} — revisar`); continue; }
    steps.push([oldN,newN]);
  }
  if(!steps.length){console.log('Nada por hacer.');await pool.end();return;}
  if(!apply){console.log('[dry-run]');steps.forEach(([o,n])=>console.log(`  ALTER TABLE "ACADEMICA" RENAME COLUMN "${o}" TO "${n}"`));console.log('(usa --apply)');await pool.end();return;}
  for(const [o,n] of steps){await pool.query(`ALTER TABLE "ACADEMICA" RENAME COLUMN "${o}" TO "${n}"`);console.log(`✓ ${o} → ${n}`);}
  const fin=await pool.query(`SELECT column_name,data_type FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name IN ('nivelacion','aprobadoNivelacion','detalleNivelacion') ORDER BY column_name`);
  console.log('\nEstado final:',JSON.stringify(fin.rows));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
