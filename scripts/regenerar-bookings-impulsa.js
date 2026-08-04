/**
 * Genera los bookings faltantes de los beneficiarios IMPULSA APROBADOS del curso
 * (uno por cada evento del curso, incluyendo ENTRENAMIENTO/EVALUACION). Idempotente
 * (no duplica). Replica generarBookingsBeneficiario. Uso: [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const APPLY=process.argv.includes("--apply");
const CAMP='AGOSTO102026';
const bkid=(i)=>`bkg_${Date.now()}_${Math.random().toString(36).slice(2,9)}${i}`;
const p=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
(async()=>{
  console.log(APPLY?"== APPLY ==":"== DRY-RUN (usa --apply) ==");
  const cur=(await p.query(`SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE UPPER("tipoCurso")='IMPULSA' AND "campaign"=$1 LIMIT 1`,[CAMP])).rows[0];
  const evs=(await p.query(`SELECT "_id","advisor","dia","hora","tipo","evento","nivel","step","tituloONivel","nombreEvento","titulo","linkZoom" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1`,[cur._id])).rows;
  console.log(`Curso ${cur._id.slice(0,12)} · ${evs.length} eventos`);
  // Beneficiarios aprobados + su ACADEMICA._id
  const bens=(await p.query(`SELECT pe."primerNombre",pe."primerApellido",pe."numeroId",pe."celular",pe."plataforma",
       (SELECT a."_id" FROM "ACADEMICA" a WHERE a."numeroId"=pe."numeroId" ORDER BY (UPPER(COALESCE(a."curso",'')) IN ('IMPULSA','WELCOME')) DESC LIMIT 1) AS "academicId"
     FROM "PEOPLE" pe WHERE pe."tipoUsuario"='BENEFICIARIO' AND UPPER(COALESCE(pe."tipoCurso",''))='IMPULSA'
       AND pe."campaign"=$1 AND pe."aprobacion" IN ('Aprobado','Aprobada')`,[CAMP])).rows;
  console.log(`Beneficiarios aprobados: ${bens.length}`);
  let totalNuevos=0, sinAcd=0;
  for(const b of bens){
    if(!b.academicId){ sinAcd++; continue; }
    const ex=(await p.query(`SELECT "eventoId","idEvento" FROM "ACADEMICA_BOOKINGS" WHERE ("idEstudiante"=$1 OR "studentId"=$1)`,[b.academicId])).rows;
    const ya=new Set(); ex.forEach(r=>{if(r.eventoId)ya.add(r.eventoId);if(r.idEvento)ya.add(r.idEvento);});
    const faltan=evs.filter(e=>!ya.has(e._id));
    totalNuevos+=faltan.length;
    if(APPLY && faltan.length){
      for(let i=0;i<faltan.length;i++){
        const e=faltan[i];
        const data={_id:bkid(i),eventoId:e._id,idEvento:e._id,studentId:b.academicId,idEstudiante:b.academicId,
          primerNombre:b.primerNombre||null,primerApellido:b.primerApellido||null,numeroId:b.numeroId||null,celular:b.celular||null,plataforma:b.plataforma||null,
          nivel:e.nivel||e.tituloONivel||null,step:e.step||e.nombreEvento||null,advisor:e.advisor||'',
          fecha:e.dia,fechaEvento:e.dia,hora:e.hora||null,tipo:e.tipo||e.evento||null,tipoEvento:e.tipo||e.evento||null,
          linkZoom:e.linkZoom||null,nombreEvento:e.nombreEvento||e.titulo||null,tituloONivel:e.tituloONivel||null,
          asistio:false,asistencia:false,participacion:false,noAprobo:false,cancelo:false,
          agendadoPor:'Sistema (regen IMPULSA)',fechaAgendamiento:new Date().toISOString(),origen:'POSTGRES'};
        const cols=Object.keys(data), vals=Object.values(data), ph=cols.map((_,j)=>`$${j+1}`).join(',');
        await p.query(`INSERT INTO "ACADEMICA_BOOKINGS" (${cols.map(c=>`"${c}"`).join(',')},"_createdDate","_updatedDate") VALUES (${ph},NOW(),NOW())`,vals);
        await p.query(`UPDATE "CALENDARIO" SET "inscritos"=COALESCE("inscritos",0)+1,"_updatedDate"=NOW() WHERE "_id"=$1`,[e._id]);
      }
    }
  }
  console.log(`Bookings ${APPLY?'creados':'a crear'}: ${totalNuevos} (${bens.length} alumnos × ~${evs.length} eventos) | sin ACADEMICA: ${sinAcd}`);
  if(APPLY){
    const v=(await p.query(`SELECT COUNT(*) n FROM "ACADEMICA_BOOKINGS" b JOIN "CALENDARIO" c ON (c."_id"=b."eventoId" OR c."_id"=b."idEvento") WHERE c."cursoCampaignId"=$1`,[cur._id])).rows[0].n;
    console.log("Bookings totales sobre el curso ahora:", v);
  }
  await p.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
