/**
 * MOSAICO — siembra APROBACION.APROBADOS.VER a los roles que ya tienen
 * APROBACION.CENTRO.VER (para que vean el nuevo ítem "Aprobados"). Idempotente.
 * Uso: node scripts/seed-aprobados-permiso.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; require('dotenv').config({path:'.env.local'})
const {Pool}=require('pg')
const APPLY=process.argv.includes('--apply')
const NUEVO='APROBACION.APROBADOS.VER', BASE='APROBACION.CENTRO.VER'
const ALWAYS=['SUPER_ADMIN','ADMIN']
;(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g,''),ssl:{rejectUnauthorized:false}})
  const {rows}=await pool.query(`SELECT rol,permisos FROM "ROL_PERMISOS"`)
  let n=0
  for(const r of rows){
    const perms=Array.isArray(r.permisos)?r.permisos:JSON.parse(r.permisos||'[]')
    const set=new Set(perms)
    if((set.has(BASE)||ALWAYS.includes(r.rol)) && !set.has(NUEVO)){
      set.add(NUEVO); n++
      console.log(`  ${APPLY?'✓':'·'} ${r.rol} +${NUEVO}`)
      if(APPLY) await pool.query(`UPDATE "ROL_PERMISOS" SET permisos=$2::jsonb,"fechaActualizacion"=NOW() WHERE rol=$1`,[r.rol,JSON.stringify([...set])])
    }
  }
  console.log(APPLY?`✅ ${n} rol(es) actualizados.`:`(dry-run) ${n} rol(es) cambiarían. --apply para escribir.`)
  await pool.end()
})().catch(e=>{console.error(e.message);process.exit(1)})
