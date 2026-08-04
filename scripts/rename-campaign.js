/**
 * Renombra una campaña en TODAS las tablas que la referencian, en una transacción.
 * Uso: node scripts/rename-campaign.js <VIEJO> <NUEVO> [--apply]
 * Tablas con columna campaign: ACADEMICA, CALENDARIO, CURSOS_CAMPAIGN, PEOPLE, REPORTE_ACADEMICO_NOTAS.
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const [OLD,NEW]=process.argv.slice(2).filter(a=>!a.startsWith("--"));
const APPLY=process.argv.includes("--apply");
const TABLES=["ACADEMICA","CALENDARIO","CURSOS_CAMPAIGN","PEOPLE","REPORTE_ACADEMICO_NOTAS"];
if(!OLD||!NEW){console.error("Uso: node scripts/rename-campaign.js <VIEJO> <NUEVO> [--apply]");process.exit(1);}
const p=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const cnt=async(t,c,val)=>{try{return Number((await c.query(`SELECT COUNT(*) n FROM "${t}" WHERE "campaign"=$1`,[val])).rows[0].n);}catch(e){return `(sin tabla: ${e.message.split("\n")[0]})`;}};
(async()=>{
  console.log(`${APPLY?"APPLY":"DRY-RUN"}  ${OLD} → ${NEW}`);
  const client=await p.connect();
  try{
    // ¿el NUEVO ya existe? (evitar fusionar por error)
    const dup=Number((await client.query(`SELECT COUNT(*) n FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1`,[NEW])).rows[0].n);
    if(dup>0){console.error(`⚠ La campaña destino "${NEW}" ya existe en CURSOS_CAMPAIGN (${dup}). Abortado para no fusionar.`);process.exit(1);}
    console.log("Filas con el nombre VIEJO por tabla:");
    for(const t of TABLES) console.log(`  ${t}: ${await cnt(t,client,OLD)}`);
    if(!APPLY){console.log("(dry-run — usa --apply)");return;}
    await client.query("BEGIN");
    const res={};
    for(const t of TABLES){
      try{const r=await client.query(`UPDATE "${t}" SET "campaign"=$1 WHERE "campaign"=$2`,[NEW,OLD]);res[t]=r.rowCount;}
      catch(e){res[t]=`(skip: ${e.message.split("\n")[0]})`;}
    }
    await client.query("COMMIT");
    console.log("Filas actualizadas:",JSON.stringify(res));
    let leftover=0;
    for(const t of TABLES){const c=await cnt(t,client,OLD);if(typeof c==="number")leftover+=c;}
    console.log(`Verificación: filas con el nombre VIEJO restantes: ${leftover} (debe ser 0)`);
  }catch(e){await client.query("ROLLBACK").catch(()=>{});console.error("ERR (rollback):",e.message);process.exit(1);}
  finally{client.release();await p.end();}
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
