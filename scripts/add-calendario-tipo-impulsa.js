/**
 * Amplía el CHECK CALENDARIO_tipo_check con 'ENTRENAMIENTO' y 'EVALUACION'
 * (tipos de evento propios de los cursos IMPULSA). Idempotente.
 * Uso: node scripts/add-calendario-tipo-impulsa.js [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const APPLY=process.argv.includes("--apply");
const p=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const WANT=['SESSION','CLUB','WELCOME','COMPLEMENTARIA','NIVELACION','OLIMPIADA','ENTRENAMIENTO','EVALUACION'];
(async()=>{
  const cur=(await p.query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='CALENDARIO_tipo_check'`)).rows[0];
  console.log("CHECK actual:", cur?cur.def:"(no existe)");
  const faltan=WANT.filter(t=>!(cur?.def||'').includes(`'${t}'`));
  if(!faltan.length){ console.log("Ya incluye ENTRENAMIENTO/EVALUACION. Nada que hacer."); await p.end(); return; }
  console.log("Faltan:", faltan.join(", "));
  if(!APPLY){ console.log("DRY-RUN (usa --apply)"); await p.end(); return; }
  const list=WANT.map(t=>`'${t}'`).join(",");
  await p.query(`ALTER TABLE "CALENDARIO" DROP CONSTRAINT IF EXISTS "CALENDARIO_tipo_check"`);
  await p.query(`ALTER TABLE "CALENDARIO" ADD CONSTRAINT "CALENDARIO_tipo_check" CHECK (("tipo")::text = ANY (ARRAY[${list}]::text[]))`);
  const nw=(await p.query(`SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='CALENDARIO_tipo_check'`)).rows[0];
  console.log("CHECK nuevo:", nw.def);
  await p.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
