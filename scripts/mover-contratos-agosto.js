/**
 * MOSAICO — mueve contratos existentes a la campaña AGOSTO172026 (cambia campaign
 * en PEOPLE+ACADEMICA de los beneficiarios y ajusta cupos usuInscritos −1/+1).
 * Solo aplica si el (tipoCurso,horario) existe en AGOSTO172026. Los estudiantes
 * están inactivos/WELCOME (sin bookings) → no hay bookings que remapear.
 * Uso: node scripts/mover-contratos-agosto.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; require('dotenv').config({path:'.env.local'})
const {Pool}=require('pg')
const APPLY=process.argv.includes('--apply')
const DEST='AGOSTO172026'
const CONTRATOS=['5-2529-26','5-2543-26','5-2523-26','5-2538-26','5-2524-26','5-2485-26','5-2500-26','5-2472-26','5-2535-26','5-2488-26','5-2525-26','5-2541-26','5-2555-26','5-2490-26','5-2549-26']
;(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g,''),ssl:{rejectUnauthorized:false}})
  let movidos=0, benefTot=0, errores=0
  for(const contrato of CONTRATOS){
    const benefs=(await pool.query(`SELECT "_id","numeroId","campaign","tipoCurso","horarioCurso","salon","primerNombre","primerApellido" FROM "PEOPLE" WHERE "contrato"=$1 AND "tipoUsuario"='BENEFICIARIO'`,[contrato])).rows
    if(!benefs.length){ console.log(`✗ ${contrato}: sin beneficiarios`); errores++; continue }
    const detalles=[]
    let ok=true
    for(const b of benefs){
      if(b.campaign===DEST){ detalles.push(`${b.primerNombre} ya en ${DEST}`); continue }
      const newC=(await pool.query(`SELECT "_id","salon" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,[DEST,b.tipoCurso,b.horarioCurso])).rows[0]
      if(!newC){ detalles.push(`❌ ${b.primerNombre}: ${b.tipoCurso} ${b.horarioCurso} NO existe en ${DEST}`); ok=false; continue }
      const oldC=(await pool.query(`SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`,[b.campaign,b.tipoCurso,b.horarioCurso])).rows[0]
      detalles.push(`${b.primerNombre} ${b.tipoCurso} ${b.horarioCurso}: ${b.campaign}→${DEST} (salon ${newC.salon})`)
      if(APPLY){
        if(oldC) await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos"=GREATEST(0,COALESCE("usuInscritos",0)-1),"_updatedDate"=NOW() WHERE "_id"=$1`,[oldC._id])
        await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos"=COALESCE("usuInscritos",0)+1,"_updatedDate"=NOW() WHERE "_id"=$1`,[newC._id])
        await pool.query(`UPDATE "PEOPLE" SET "campaign"=$2,"salon"=$3,"_updatedDate"=NOW() WHERE "_id"=$1`,[b._id,DEST,newC.salon])
        await pool.query(`UPDATE "ACADEMICA" SET "campaign"=$2,"salon"=$3,"_updatedDate"=NOW() WHERE ("peopleId"=$1 OR "numeroId"=$4)`,[b._id,DEST,newC.salon,b.numeroId])
      }
      benefTot++
    }
    console.log(`${ok?'✔':'⚠'} ${contrato}: ${detalles.join(' | ')}`)
    if(ok) movidos++
  }
  console.log(`\n${APPLY?'APLICADO':'DRY-RUN'}: ${movidos}/${CONTRATOS.length} contratos, ${benefTot} beneficiarios movidos.`)
  await pool.end()
})().catch(e=>{console.error(e.message);process.exit(1)})
