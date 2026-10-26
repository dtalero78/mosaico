/**
 * MOSAICO — Completa el currículo de los salones de sábado (2 h) con corte propio.
 *
 * Para cada curso con `dosBloquesDesde`, calcula cuántas lecciones le faltan para
 * cubrir su currículo repartiendo dos lecciones por clase desde ese corte, y agrega
 * los sábados necesarios con la MISMA ampliación de Ajuste Cursos (endpoint
 * POST /api/postgres/campaigns/[id]/ajuste): crea clases, agenda a los alumnos
 * aprobados, valida colisión de guía y re-mapea las lecciones.
 *
 * Requiere el servidor corriendo (NEXTAUTH_URL) y sesión de administrador:
 *   BASE=http://localhost:3002 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *   node scripts/ampliar-sabados-dos-bloques.js [--apply]
 * Ensayo por defecto (vista previa por salón).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const B = process.env.BASE || 'http://localhost:3002';
const MOTIVO = 'Sábados de 2 horas con dos lecciones por clase: se agregan sábados para completar el currículo';
const jar = {};
const ck = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const sv = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
const add = (iso, d) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10);
const post = async (id, body) => {
  const r = await fetch(`${B}/api/postgres/campaigns/${id}/ajuste`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck() }, body: JSON.stringify(body) });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  let r = await fetch(`${B}/api/auth/csrf`); sv(r); const { csrfToken } = await r.json();
  r = await fetch(`${B}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: ck() },
    body: new URLSearchParams({ csrfToken, email: process.env.ADMIN_EMAIL || 'admin@mosaico.com', password: process.env.ADMIN_PASSWORD || '', json: 'true' }) }); sv(r);
  const seqOf = {};
  for (const t of ['DANSHI', 'SENPAI', 'YOJI', 'OKINA', 'KODOMO']) {
    const rows = (await p.query(`SELECT code FROM "NIVELES" WHERE curso=$1 AND step<>'WELCOME' ORDER BY orden NULLS LAST, step`, [t])).rows;
    let tr = 0, prev = null; for (const x of rows) { if (prev !== null && x.code !== prev) tr++; prev = x.code; }
    seqOf[t] = { norm: rows.length, sint: rows.length + tr + 1 };
  }
  const cs = (await p.query(`SELECT cc._id, cc."tipoCurso" t, cc.campaign, cc.salon, cc."horarioCurso" h, cc."finalCurso"::text fin, cc."dosBloquesDesde"::text corte,
      COALESCE(cc."evalSinteticaPorModulo", false) sint,
      (SELECT COUNT(*) FROM "CALENDARIO" c WHERE c."cursoCampaignId"=cc._id AND c.dia < cc."dosBloquesDesde")::int antes,
      (SELECT COUNT(*) FROM "CALENDARIO" c WHERE c."cursoCampaignId"=cc._id AND c.dia >= cc."dosBloquesDesde")::int despues
      FROM "CURSOS_CAMPAIGN" cc WHERE cc."dosBloquesDesde" IS NOT NULL ORDER BY 2,3,4`)).rows;
  for (const c of cs) {
    const seq = c.sint ? seqOf[c.t].sint : seqOf[c.t].norm;
    const falta = Math.max(0, seq - (c.antes + 2 * c.despues)); const n = Math.ceil(falta / 2);
    let linea = `${c.t} ${c.campaign} ${c.salon} ${c.h}: faltan ${falta} lecc → +${n} sáb`;
    if (!n) { console.log(linea, '(sin ampliar)'); continue; }
    let fin = add(c.fin.slice(0, 10), n * 7), ok = null;
    for (let i = 0; i < 8 && !ok; i++) {
      const q = await post(c._id, { accion: 'ampliacion', fecha: fin });
      if (q.s !== 200) { linea += ` ✗ ${q.j.error || q.s}`; break; }
      const mine = q.j.cursos.find(x => x._id === c._id) || q.j.cursos[0];
      if (mine.clasesNuevas === n) { ok = fin; linea += ` ✓ final ${fin} (hasta ${mine.hasta})`; }
      else fin = add(fin, (n - mine.clasesNuevas) * 7);
    }
    if (!ok && !linea.includes('✗')) linea += ' ✗ no convergió';
    console.log(linea);
    if (ok && APPLY) { const q = await post(c._id, { accion: 'ampliacion', fecha: ok, apply: true, motivo: MOTIVO }); console.log('   aplicado:', q.s, q.j.error || ''); }
  }
  await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
