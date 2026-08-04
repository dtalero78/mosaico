/**
 * Reconfigura el curso IMPULSA de AGOSTO172026 al modelo de calendario fijo y lo
 * mueve a la campaña AGOSTO102026. Reemplaza los eventos auto-generados por los 48
 * eventos materializados (39 SESION + 4 ENTRENAMIENTO + 5 EVALUACION) del cohorte
 * ago–nov 2026. Idempotente. Uso: node scripts/reconfigurar-impulsa-agosto102026.js [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const { computeImpulsaCalendario } = require("./.impulsa-lib/impulsa-calendario.js");
const APPLY=process.argv.includes("--apply");
const TZ='America/Santiago';
const NEW_CAMPAIGN='AGOSTO102026', OLD_CAMPAIGN='AGOSTO172026';
const FINAL='2026-11-25';
const CFG={
  inicioSesiones:'2026-08-10', finSesiones:'2026-11-13',
  festivos:['2026-09-18','2026-10-12'],
  entrenamientos:[{fecha:'2026-08-22'},{fecha:'2026-10-03'},{fecha:'2026-10-30',horaInicio:'18:30'},{fecha:'2026-11-14'}],
  evaluaciones:[{fecha:'2026-11-16'},{fecha:'2026-11-18'},{fecha:'2026-11-20'},{fecha:'2026-11-23'},{fecha:'2026-11-25'}],
};
const evid=(i)=>`evt_${Date.now()}_${Math.random().toString(36).slice(2,9)}${i}`;
const nombreEvento=(ev,horario)=>ev.tipo==='SESSION'?(horario||`${ev.horaInicio}-${ev.horaFin}`):ev.tipo==='ENTRENAMIENTO'?'Entrenamiento':'Evaluación';
const p=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
(async()=>{
  console.log(APPLY?"== APPLY ==":"== DRY-RUN (usa --apply) ==");
  const cur=(await p.query(`SELECT * FROM "CURSOS_CAMPAIGN" WHERE UPPER("tipoCurso")='IMPULSA' AND "campaign"=$1 LIMIT 1`,[OLD_CAMPAIGN])).rows[0];
  if(!cur){console.log("No hay curso IMPULSA en",OLD_CAMPAIGN,"(¿ya movido?)");await p.end();return;}
  console.log(`Curso IMPULSA: ${cur._id} salon ${cur.salon} horario "${cur.horarioCurso}"`);
  const calc=computeImpulsaCalendario(CFG);
  const eventos=[...calc.sesiones,...calc.entrenamientos,...calc.evaluaciones];
  console.log(`Calendario nuevo: ${calc.resumen.sesiones} SESION + ${calc.resumen.entrenamientos} ENTREN + ${calc.resumen.evaluaciones} EVAL = ${calc.resumen.total} (horas ${calc.resumen.horas})`);
  console.log(`Festivos omitidos: ${calc.resumen.festivosOmitidos.join(', ')} | Colisiones: ${calc.resumen.colisiones.map(c=>c.fecha).join(', ')}`);
  const bens=(await p.query(`SELECT "numeroId" FROM "PEOPLE" WHERE "tipoUsuario"='BENEFICIARIO' AND UPPER(COALESCE("tipoCurso",''))='IMPULSA' AND "campaign"=$1`,[OLD_CAMPAIGN])).rows.map(r=>r.numeroId);
  const oldEv=(await p.query(`SELECT COUNT(*) n FROM "CALENDARIO" WHERE "cursoCampaignId"=$1`,[cur._id])).rows[0].n;
  console.log(`Move de campaña ${OLD_CAMPAIGN}→${NEW_CAMPAIGN}: 1 curso, ${bens.length} beneficiarios (PEOPLE+ACADEMICA), ${oldEv} eventos viejos → ${eventos.length} nuevos. finalCurso→${FINAL}`);
  if(!APPLY){await p.end();return;}

  // 1) Mover campaña del curso + fechas
  await p.query(`UPDATE "CURSOS_CAMPAIGN" SET "campaign"=$1,"finalCurso"=$2::date,"inicioCurso"=$3::date,"_updatedDate"=NOW() WHERE "_id"=$4`,[NEW_CAMPAIGN,FINAL,CFG.inicioSesiones,cur._id]);
  // 2) Beneficiarios IMPULSA
  const up1=await p.query(`UPDATE "PEOPLE" SET "campaign"=$1,"_updatedDate"=NOW() WHERE "tipoUsuario"='BENEFICIARIO' AND UPPER(COALESCE("tipoCurso",''))='IMPULSA' AND "campaign"=$2`,[NEW_CAMPAIGN,OLD_CAMPAIGN]);
  const up2= bens.length ? await p.query(`UPDATE "ACADEMICA" SET "campaign"=$1 WHERE "numeroId"=ANY($2) AND "campaign"=$3`,[NEW_CAMPAIGN,bens,OLD_CAMPAIGN]) : {rowCount:0};
  let up3={rowCount:0}; try{ up3=await p.query(`UPDATE "REPORTE_ACADEMICO_NOTAS" SET "campaign"=$1 WHERE "campaign"=$2 AND "numeroId"=ANY($3)`,[NEW_CAMPAIGN,OLD_CAMPAIGN,bens]);}catch{}
  console.log(`PEOPLE movidos: ${up1.rowCount} | ACADEMICA: ${up2.rowCount} | REPORTE_NOTAS: ${up3.rowCount}`);

  // 3) Re-materializar eventos (borra + inserta 48 con AT TIME ZONE Santiago)
  await p.query(`DELETE FROM "CALENDARIO" WHERE "cursoCampaignId"=$1`,[cur._id]);
  const titulo=[NEW_CAMPAIGN,'IMPULSA',(cur.salon||'').trim()].filter(Boolean).join(' - ');
  const advisor=(cur.guia||'').trim(); const limite=Number(cur.numeroUsuarios)||0;
  const cols='"_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","campaign","curso","salon","_createdDate","_updatedDate"';
  const fixed=[NEW_CAMPAIGN,'IMPULSA',(cur.salon||'').trim()]; const params=[...fixed]; const rowsSql=[];
  eventos.forEach((ev,r)=>{const b=3+r*12;
    rowsSql.push(`($${b+1},$${b+2},$${b+2},$${b+3},$${b+4},($${b+5}::timestamp AT TIME ZONE $${b+6}),$${b+7},$${b+8},$${b+9},$${b+9},$${b+10},$${b+11},$${b+12},0,'POSTGRES',false,$1,$2,$3,NOW(),NOW())`);
    params.push(evid(r),ev.tipo,ev.fecha,ev.horaInicio,`${ev.fecha} ${ev.horaInicio}:00`,TZ,advisor,'IMPULSA',titulo,nombreEvento(ev,cur.horarioCurso),limite,cur._id);
  });
  await p.query(`INSERT INTO "CALENDARIO" (${cols}) VALUES ${rowsSql.join(', ')}`,params);

  // 4) Config
  await p.query(`INSERT INTO "IMPULSA_CURSO_CONFIG" ("_id","cursoCampaignId","authorTz","inicioSesiones","finSesiones","festivos","entrenamientos","evaluaciones","resumen","materializado","creadoPor","_createdDate","_updatedDate")
    VALUES ($1,$2,$3,$4::date,$5::date,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,true,'reconfig-script',NOW(),NOW())
    ON CONFLICT ("cursoCampaignId") DO UPDATE SET "authorTz"=EXCLUDED."authorTz","inicioSesiones"=EXCLUDED."inicioSesiones","finSesiones"=EXCLUDED."finSesiones","festivos"=EXCLUDED."festivos","entrenamientos"=EXCLUDED."entrenamientos","evaluaciones"=EXCLUDED."evaluaciones","resumen"=EXCLUDED."resumen","materializado"=true,"_updatedDate"=NOW()`,
    [`aud_${Date.now()}`,cur._id,TZ,CFG.inicioSesiones,CFG.finSesiones,JSON.stringify(CFG.festivos),JSON.stringify(CFG.entrenamientos),JSON.stringify(CFG.evaluaciones),JSON.stringify(calc.resumen)]);

  // 5) Verificación
  const ver=(await p.query(`SELECT "tipo", COUNT(*) n, MIN("dia") pri, MAX("dia") ult FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 GROUP BY "tipo" ORDER BY "tipo"`,[cur._id])).rows;
  console.log("\n=== Eventos materializados ==="); console.table(ver.map(x=>({tipo:x.tipo,n:Number(x.n),primero:x.pri&&new Date(x.pri).toISOString(),ultimo:x.ult&&new Date(x.ult).toISOString()})));
  const camps=(await p.query(`SELECT "campaign", COUNT(*) n FROM "CURSOS_CAMPAIGN" WHERE UPPER("tipoCurso")='IMPULSA' GROUP BY 1`)).rows;
  console.log("Cursos IMPULSA por campaña:",camps.map(c=>`${c.campaign}=${c.n}`).join(', '));
  await p.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
