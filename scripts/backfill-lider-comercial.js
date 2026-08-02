/**
 * Backfill del líder-tope (escalera del CRM) en:
 *   EQUIPO_COMERCIAL.lider/liderCorreo (por asesor)
 *   PEOPLE.liderComercial/liderComercialCorreo (titulares, por asesor)
 * Resuelve subiendo User.supervisorId en el CRM hasta GERENTE/JEFE_GRUPO/SALES_MANAGER.
 * Uso: node scripts/backfill-lider-comercial.js [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const APPLY=process.argv.includes("--apply");
const mo=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const crm=new Pool({connectionString:(process.env.CRM_DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const RANKS=['SALES_MANAGER','GERENTE','JEFE_GRUPO'];
const SQL=(byEmail)=>`WITH RECURSIVE seed AS (SELECT id,"firstName","lastName",email,"position","supervisorId" FROM "User" WHERE ${byEmail?`lower(email)=$1`:`lower("firstName"||' '||"lastName")=lower($1)`} ORDER BY ("isActive" IS TRUE) DESC LIMIT 1), up AS (SELECT s.*,0 AS depth FROM seed s UNION ALL SELECT u.id,u."firstName",u."lastName",u.email,u."position",u."supervisorId",up.depth+1 FROM "User" u JOIN up ON u.id=up."supervisorId" WHERE up.depth<20) SELECT "firstName","lastName",email,"position"::text AS pos FROM up WHERE "position"::text=ANY($2::text[]) ORDER BY depth ASC LIMIT 1;`;
const cache=new Map();
async function resolver(correo,nombre){
  const key=(correo||"").toLowerCase()+"|"+(nombre||"").toLowerCase();
  if(cache.has(key)) return cache.get(key);
  let r=null;
  if(correo){ r=(await crm.query(SQL(true),[correo.toLowerCase(),RANKS])).rows[0]; }
  if(!r && nombre){ r=(await crm.query(SQL(false),[nombre,RANKS])).rows[0]; }
  const out=r?{nombre:`${r.firstName||''} ${r.lastName||''}`.trim(),correo:r.email||null}:null;
  cache.set(key,out); return out;
}
(async()=>{
  console.log(APPLY?"== APPLY ==":"== DRY-RUN (usa --apply) ==");
  // 1) EQUIPO_COMERCIAL
  const eq=(await mo.query(`SELECT "_id","nombre","correo" FROM "EQUIPO_COMERCIAL"`)).rows;
  let eqOk=0;
  for(const a of eq){
    const l=await resolver(a.correo,a.nombre);
    console.log(`  EQ ${(a.nombre||'').padEnd(28)} → ${l?l.nombre:'(sin líder)'}`);
    if(l&&APPLY){ await mo.query(`UPDATE "EQUIPO_COMERCIAL" SET "lider"=$2,"liderCorreo"=$3,"_updatedDate"=NOW() WHERE "_id"=$1`,[a._id,l.nombre,l.correo]); eqOk++; }
    else if(l) eqOk++;
  }
  // 2) PEOPLE titulares (por par asesor/asesorMail distinto)
  const pares=(await mo.query(`SELECT DISTINCT "asesor","asesorMail" FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND "asesor" IS NOT NULL AND "asesor"<>''`)).rows;
  let pplPares=0, pplRows=0;
  for(const par of pares){
    const l=await resolver(par.asesorMail,par.asesor);
    if(!l) continue;
    pplPares++;
    const w = par.asesorMail ? `"asesor"=$3 AND "asesorMail"=$4` : `"asesor"=$3 AND ("asesorMail" IS NULL OR "asesorMail"='')`;
    const params = par.asesorMail ? [l.nombre,l.correo,par.asesor,par.asesorMail] : [l.nombre,l.correo,par.asesor];
    if(APPLY){ const r=await mo.query(`UPDATE "PEOPLE" SET "liderComercial"=$1,"liderComercialCorreo"=$2,"_updatedDate"=NOW() WHERE "tipoUsuario"='TITULAR' AND ${w}`,params); pplRows+=r.rowCount; }
    else { const r=await mo.query(`SELECT COUNT(*) n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND ${w}`,params.slice(2)); pplRows+=Number(r.rows[0].n); }
  }
  console.log(`\nEQUIPO_COMERCIAL con líder: ${eqOk}/${eq.length}`);
  console.log(`PEOPLE titulares: ${pplPares} asesores resueltos → ${pplRows} titulares ${APPLY?'actualizados':'a actualizar'}`);
  await mo.end(); await crm.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
