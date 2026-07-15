/**
 * MOSAICO — actividades externas por lección (Kahoot / WordWall).
 * Agrega a NIVELES:
 *   "actividadKahoot"   TEXT  → URL de la actividad Kahoot de la lección
 *   "actividadWordwall" TEXT  → URL de la actividad WordWall de la lección
 * Uso: node scripts/add-niveles-actividades-columns.js
 * Idempotente (ADD COLUMN IF NOT EXISTS).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; require('dotenv').config({path:'.env.local'})
const {Pool}=require('pg')
;(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g,''),ssl:{rejectUnauthorized:false}})
  try{
    for(const col of ['actividadKahoot','actividadWordwall']){
      await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "${col}" TEXT`)
      console.log('  ✓ NIVELES."'+col+'" TEXT')
    }
    const c=await pool.query(`SELECT COUNT(*)::int n FROM "NIVELES"`)
    console.log('✅ Columnas de actividades agregadas ('+c.rows[0].n+' lecciones).')
  }catch(e){console.error('ERROR:',e.message);process.exit(1)}finally{await pool.end()}
})()
