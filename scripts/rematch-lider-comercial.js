/**
 * Re-match de asesores "sin líder" contra el CRM con normalización difusa
 * (sin acentos, case-insensitive, primer+último token, recorta basura tipo
 * "Full Executive: X") y resuelve el líder en memoria (User.supervisorId).
 * Actualiza PEOPLE.liderComercial (y EQUIPO_COMERCIAL si hay fila por correo).
 * Uso: node scripts/rematch-lider-comercial.js [--apply]
 */
const {Pool}=require("pg");require("dotenv").config({path:".env.local"});
const APPLY=process.argv.includes("--apply");
const mo=new Pool({connectionString:(process.env.DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const crm=new Pool({connectionString:(process.env.CRM_DATABASE_URL||"").replace(/[?&]sslmode=[^&]*/g,""),ssl:{rejectUnauthorized:false}});
const RANKS=new Set(['SALES_MANAGER','GERENTE','JEFE_GRUPO']);
const norm=s=>(s||"").toString().split(/full\s*executive/i)[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const fl=n=>{const t=n.split(" ").filter(Boolean);return t.length?t[0]+" "+t[t.length-1]:"";};
(async()=>{
  const U=(await crm.query(`SELECT id,"firstName","lastName",lower(email) email,"position"::text pos,"supervisorId" sup,"isActive" act FROM "User"`)).rows;
  const byId=new Map(U.map(u=>[u.id,u]));
  const byFull=new Map(), byFL=new Map(), byEmail=new Map(), byLocal=new Map();
  const push=(m,k,u)=>{if(!k)return;if(!m.has(k))m.set(k,[]);m.get(k).push(u);};
  for(const u of U){const full=norm(`${u.firstName||""} ${u.lastName||""}`);push(byFull,full,u);push(byFL,fl(full),u);if(u.email){byEmail.set(u.email,u);push(byLocal,u.email.split("@")[0],u);}}
  const lider=u=>{let cur=u,g=0;while(cur&&g++<20){if(RANKS.has(cur.pos))return cur;cur=cur.sup?byId.get(cur.sup):null;}return null;};
  const uniq=arr=>{const act=arr.filter(x=>x.act);const s=(act.length?act:arr);const ids=new Set(s.map(x=>x.id));return ids.size===1?s[0]:null;};
  for(const u of U){u._n=norm(`${u.firstName||""} ${u.lastName||""}`);u._t=u._n.split(" ").filter(Boolean);u._s=new Set(u._t);}
  const subset=(A,B)=>[...A].every(x=>B.has(x));
  function match(asesor,correo){
    if(correo){const e=correo.toLowerCase();if(byEmail.has(e))return{u:byEmail.get(e),via:"email"};const loc=e.split("@")[0];if(byLocal.has(loc)){const u=uniq(byLocal.get(loc));if(u)return{u,via:"email-local"};}}
    const n=norm(asesor);if(!n)return null;
    const T=n.split(" ").filter(Boolean);const Ts=new Set(T);const tf=T[0],tl=T[T.length-1];
    let best=[],bestScore=0;
    for(const u of U){
      if(!u._n)continue;
      let shared=0;for(const t of Ts)if(u._s.has(t))shared++;
      let sc=0;
      if(u._n===n)sc=100;
      else if(shared>=2&&(subset(Ts,u._s)||subset(u._s,Ts)))sc=90;
      else if(shared>=2&&(tf===u._t[0]||tl===u._t[u._t.length-1]))sc=80;
      if(sc>bestScore){bestScore=sc;best=[u];}
      else if(sc===bestScore&&sc>0&&!best.some(b=>b.id===u.id))best.push(u);
    }
    if(bestScore===0)return null;
    const u=uniq(best);if(u)return{u,via:bestScore===100?"nombre":"nombre~"};
    return{amb:best};
  }
  const pares=(await mo.query(`SELECT DISTINCT COALESCE(TRIM("asesor"),'') asesor, COALESCE(TRIM("asesorMail"),'') correo
     FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND "liderComercial" IS NULL AND COALESCE("contrato",'') NOT LIKE 'PRB-%' AND COALESCE(TRIM("asesor"),'')<>''`)).rows;
  console.log(APPLY?"== APPLY ==":"== DRY-RUN (usa --apply) =="); let applied=0, rowsTot=0, amb=0, no=0;
  const out=[];
  for(const par of pares){
    const m=match(par.asesor,par.correo);
    if(!m){ out.push({asesor:par.asesor,match:"— (sin match)",lider:"—"}); no++; continue; }
    if(m.amb){ out.push({asesor:par.asesor,match:"AMBIGUO: "+m.amb.map(x=>`${x.firstName} ${x.lastName}`).join(" / "),lider:"?"}); amb++; continue; }
    const l=lider(m.u);
    const lname=l?`${l.firstName} ${l.lastName}`:"(sin líder en árbol)";
    out.push({asesor:par.asesor,match:`${m.u.firstName} ${m.u.lastName} [${m.via}]`,lider:lname});
    if(l){
      const w=par.correo?`TRIM("asesor")=$3 AND TRIM("asesorMail")=$4`:`TRIM("asesor")=$3 AND COALESCE(TRIM("asesorMail"),'')=''`;
      const prm=par.correo?[l.firstName+" "+l.lastName,l.email,par.asesor,par.correo]:[l.firstName+" "+l.lastName,l.email,par.asesor];
      if(APPLY){const r=await mo.query(`UPDATE "PEOPLE" SET "liderComercial"=$1,"liderComercialCorreo"=$2,"_updatedDate"=NOW() WHERE "tipoUsuario"='TITULAR' AND "liderComercial" IS NULL AND ${w}`,prm);rowsTot+=r.rowCount;if(r.rowCount)applied++;
        if(par.correo)await mo.query(`UPDATE "EQUIPO_COMERCIAL" SET "lider"=$1,"liderCorreo"=$2,"_updatedDate"=NOW() WHERE LOWER(TRIM("correo"))=LOWER(TRIM($3))`,[l.firstName+" "+l.lastName,l.email,par.correo]);
      } else {const wc=par.correo?`"asesor"=$1 AND "asesorMail"=$2`:`"asesor"=$1 AND ("asesorMail" IS NULL OR "asesorMail"='')`;const pc=par.correo?[par.asesor,par.correo]:[par.asesor];const r=await mo.query(`SELECT COUNT(*) n FROM "PEOPLE" WHERE "tipoUsuario"='TITULAR' AND "liderComercial" IS NULL AND ${wc}`,pc);rowsTot+=Number(r.rows[0].n);applied++;}
    }
  }
  console.table(out);
  console.log(`\nAsesores con match+líder: ${applied} → titulares ${APPLY?'actualizados':'a actualizar'}: ${rowsTot} | ambiguos: ${amb} | sin match: ${no}`);
  await mo.end();await crm.end();
})().catch(e=>{console.error("ERR",e.message);process.exit(1)});
