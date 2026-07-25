/**
 * Genera docs/inconsistencias-contratosfebrero2026.csv: por cada fila del CSV de
 * febrero, verifica contra PEOPLE si el contrato/persona YA existe (duplicado) y en
 * qué campaña está hoy. NO escribe nada en la BD (solo lectura + genera el CSV).
 */
require('dotenv').config({ path: '.env.local' });
const fs = require('fs'); const { Pool } = require('pg');
const pool = new Pool({ connectionString:(process.env.DATABASE_URL||'').replace(/[?&]sslmode=[^&]*/g,''), ssl:{rejectUnauthorized:false} });
const strip = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'');
const normId = s => strip(s).toUpperCase().replace(/[.\s\-_]/g,'').trim();
const q = s => { const v=String(s??''); return /[";\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v; };
(async()=>{
  const buf=fs.readFileSync('docs/contratosfebrero2026.csv'); const raw=buf.slice(3).toString('utf8');
  const lines=raw.split(/\r?\n/).filter(l=>l.trim()); const H=lines[0].split(';').map(s=>s.trim());
  const ci=n=>H.indexOf(n); const get=(r,n)=>{const i=ci(n);return i>=0?String(r[i]||'').trim():'';};
  const rows=lines.slice(1).map(l=>l.split(';'));

  // lookup masivo PEOPLE por contrato y por numeroId
  const contratos=[...new Set(rows.map(r=>get(r,'noContrato')).filter(Boolean))];
  const allIds=[...new Set(rows.flatMap(r=>[get(r,'idTitular'),get(r,'idbeneficiaio1'),get(r,'idbeneficiaio2')]).map(normId).filter(Boolean))];
  const pc=(await pool.query(`SELECT "contrato","primerNombre","primerApellido","campaign","tipoUsuario" FROM "PEOPLE" WHERE "contrato"=ANY($1)`,[contratos])).rows;
  const byContrato=new Map(); pc.forEach(r=>{ if(!byContrato.has(r.contrato))byContrato.set(r.contrato,[]); byContrato.get(r.contrato).push(r); });
  const pid=(await pool.query(`SELECT "numeroId","contrato","campaign","tipoUsuario","primerNombre","primerApellido" FROM "PEOPLE" WHERE "numeroId"=ANY($1)`,[allIds])).rows;
  const byId=new Map(); pid.forEach(r=>{ if(!byId.has(r.numeroId))byId.set(r.numeroId,[]); byId.get(r.numeroId).push(r); });
  // campaña real de los ALUMNOS (beneficiarios) por contrato — ahí vive el curso
  const alumnosCamp=(await pool.query(`SELECT "contrato", STRING_AGG(DISTINCT COALESCE("campaign",'(sin campaña)'),', ') camp FROM "PEOPLE" WHERE "contrato"=ANY($1) AND "tipoUsuario"='BENEFICIARIO' GROUP BY "contrato"`,[contratos])).rows;
  const campByContrato=new Map(alumnosCamp.map(r=>[r.contrato,r.camp]));

  const out=[['noContrato','titular','idTitular','contratoExisteExacto','campanaAlumnosActual','idTitularExiste','idTitularEnContrato','beneficiariosCSV','beneficiariosExistenId','diagnostico'].join(';')];
  let dupExact=0,dupPorId=0,noExiste=0;
  for(const r of rows){
    const noC=get(r,'noContrato'); const tit=`${get(r,'primerNombreTitular')} ${get(r,'primerApellidoTitular')}`.trim();
    const idT=get(r,'idTitular'); const nIdT=normId(idT);
    const existeExacto=byContrato.has(noC);
    const idHits0=byId.get(nIdT)||[];
    const contratoReal=existeExacto?noC:[...new Set(idHits0.map(x=>x.contrato))][0];
    const campTit=(contratoReal&&campByContrato.get(contratoReal))||(existeExacto||idHits0.length?'(titular sin curso / sin alumnos)':'—');
    const idHits=idHits0;
    const idExiste=idHits.length>0;
    const idEnContrato=[...new Set(idHits.map(x=>x.contrato))].join('|')||'—';
    const benefs=[['idbeneficiaio1','nombre1beneciciario1','apellido1beneficiario1'],['idbeneficiaio2','nombre1beneciciario2','apellido1beneficiario2']]
      .map(([idc,nc,ac])=>({id:get(r,idc),nom:`${get(r,nc)} ${get(r,ac)}`.trim()})).filter(b=>b.id);
    const benefCSV=benefs.map(b=>`${b.nom} [${b.id}]`).join(' + ')||'(sin beneficiario)';
    const benefExisten=benefs.map(b=>byId.has(normId(b.id))?'sí':'NO').join('|')||'—';
    let diag;
    if(existeExacto){ diag='DUPLICADO — contrato ya existe'; dupExact++; }
    else if(idExiste){ diag=`DUPLICADO por persona — nº con año errado; la persona ya está en ${idEnContrato}`; dupPorId++; }
    else { diag='NO existe (nuevo)'; noExiste++; }
    out.push([noC,tit,idT,existeExacto?'sí':'NO',campTit,idExiste?'sí':'NO',idEnContrato,benefCSV,benefExisten,diag].map(q).join(';'));
  }
  fs.writeFileSync('docs/inconsistencias-contratosfebrero2026.csv','﻿'+out.join('\r\n'));
  console.log(`CSV generado: docs/inconsistencias-contratosfebrero2026.csv (${rows.length} filas)`);
  console.log(`  DUPLICADO exacto (contrato ya existe): ${dupExact}`);
  console.log(`  DUPLICADO por persona (nº con año errado -25): ${dupPorId}`);
  console.log(`  NUEVO (no existe): ${noExiste}`);
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
