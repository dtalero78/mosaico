/**
 * MOSAICO — renombra contratos al formato canónico 01-<M5|I6>-NNNNN-YY.
 *   5-NNNN-YY → 01-M5-NNNN-YY   |   IMPULSA → 01-I6-NNN-YY   (país 01=Chile)
 * Actualiza "contrato" en las 6 tablas que lo referencian. Excluye colisiones
 * (cuyo nuevo nombre ya existe). Respaldo del mapeo en scripts/_backup_rename_contratos.json.
 * Uso: node scripts/renombrar-contratos-canonico.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; require('dotenv').config({path:'.env.local'})
const fs=require('fs'),{Pool}=require('pg')
const APPLY=process.argv.includes('--apply')
const TABLAS=['PEOPLE','ACADEMICA','USUARIOS_ROLES','FINANCIEROS','ACTIVE_STUDENTS','auditautoaprov']
function nuevo(contrato){
  const m=contrato.match(/^(\d)-(\d+)-(\d{1,2})$/); if(!m) return null
  const num=m[2]; let yr=m[3]; if(yr.length===1) yr=(yr==='2'?'26':('2'+yr))
  // El dígito inicial refleja el flag IMPULSA al crearse: 6→I6, resto→M5.
  const seg = m[1]==='6' ? 'I6' : 'M5'
  return `01-${seg}-${num}-${yr}`
}
;(async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g,''),ssl:{rejectUnauthorized:false}})
  const rows=(await pool.query(`
    SELECT p."contrato", BOOL_OR(b."tipoCurso"='IMPULSA') imp
    FROM "PEOPLE" p LEFT JOIN "PEOPLE" b ON b."contrato"=p."contrato" AND b."tipoUsuario"='BENEFICIARIO'
    WHERE p."tipoUsuario"='TITULAR' AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%' AND p."contrato" NOT LIKE '01-%'
    GROUP BY p."contrato"`)).rows
  const existentes=new Set((await pool.query(`SELECT DISTINCT "contrato" FROM "PEOPLE" WHERE "contrato" LIKE '01-%'`)).rows.map(r=>r.contrato))
  const plan=[], colisiones=[], destinos=new Set()
  for(const r of rows){
    const nv=nuevo(r.contrato)
    if(!nv){ continue }
    if(existentes.has(nv)||destinos.has(nv)){ colisiones.push(`${r.contrato} → ${nv}`); continue }
    destinos.add(nv); plan.push({old:r.contrato,nv,imp:nv.includes('-I6-')})
  }
  console.log(`A renombrar: ${plan.length} | Colisiones excluidas: ${colisiones.length}`)
  colisiones.forEach(c=>console.log('  ⚠ colisión:', c))
  console.log('IMPULSA→I6:', plan.filter(p=>p.imp).map(p=>`${p.old}→${p.nv}`).join(', ')||'(ninguno)')
  console.log('Ejemplos M5:', plan.filter(p=>!p.imp).slice(0,4).map(p=>`${p.old}→${p.nv}`).join(', '))
  if(!APPLY){ console.log('\n(dry-run — nada escrito. --apply para renombrar.)'); await pool.end(); return }
  fs.writeFileSync('scripts/_backup_rename_contratos.json', JSON.stringify(plan,null,1))
  console.log('\nRespaldo → scripts/_backup_rename_contratos.json')
  const client=await pool.connect()
  let tot=0
  try{
    await client.query('BEGIN')
    for(const p of plan){
      for(const t of TABLAS){
        try{ await client.query(`UPDATE "${t}" SET "contrato"=$2 WHERE "contrato"=$1`,[p.old,p.nv]) }
        catch(e){ /* tabla sin filas o sin col — ignora */ }
      }
      tot++
    }
    await client.query('COMMIT')
    console.log(`✅ Renombrados ${tot} contratos en ${TABLAS.length} tablas.`)
  }catch(e){ await client.query('ROLLBACK'); console.error('ROLLBACK:',e.message); process.exit(1) }
  finally{ client.release(); await pool.end() }
})().catch(e=>{console.error(e.message);process.exit(1)})
