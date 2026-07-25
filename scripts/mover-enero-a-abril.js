/**
 * Mueve TODOS los beneficiarios de ENERO172026 → ABRIL132026, SIN borrar la
 * campaña ENERO (sus cursos quedan; solo se vacían de alumnos).
 *
 * Decisiones (usuario, 2026-07-25):
 *  - Los horarios de enero que ABRIL no tiene (SÁB 10:00-12:00 en OKINA/KODOMO/
 *    DANSHI/YOJI/SENPAI y SENPAI MAR-JUE 19:00-19:50) se CREAN en ABRIL132026
 *    (con fechas de ABRIL: inicioCurso 2026-04-13, duración 11) vía el endpoint
 *    POST /api/postgres/campaigns (que además genera los eventos del calendario).
 *  - Mantener estado: solo se cambia campaign/salon/inicioCurso en PEOPLE+ACADEMICA
 *    y se ajustan cupos (usuInscritos −1 en ENERO / +1 en ABRIL). No se toca
 *    aprobación ni activación. Los 66 están inactivos con 0 bookings → traslado limpio.
 *
 * Uso:
 *   node scripts/mover-enero-a-abril.js                 # dry-run
 *   node scripts/mover-enero-a-abril.js --apply         # crea cursos faltantes + mueve
 *   flags: --base=http://localhost:3001 --email= --password=
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const APPLY = !!args.apply;
const BASE = (args.base || 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = args.email || 'admin@mosaico.com';
const PASSWORD = args.password || process.env.ADMIN_PASSWORD || '';
const FROM = 'ENERO172026', DEST = 'ABRIL132026';

// Plantilla ABRIL132026 (uniforme): inicioCurso 2026-04-13, duración 11, cupos 12.
const ABRIL = { inicioCampania: '2026-04-01', finalCampaign: '2026-04-13', inicioCurso: '2026-04-13', duracion: 11, cupos: 12 };

const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });

// ── login (para el POST de cursos faltantes) ────────────────────────────────
const jar = {};
const setC = res => (res.headers.getSetCookie?.() || []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function login() {
  if (!PASSWORD) throw new Error('Falta --password= (o ADMIN_PASSWORD en .env.local)');
  let r = await fetch(`${BASE}/api/auth/csrf`); setC(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() }, body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true' }) });
  setC(r);
  const s = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie() } }).then(x => x.json());
  if (!s?.user?.email) throw new Error('Login falló');
  console.log(`🔑 login OK como ${s.user.email} (${s.user.role})`);
}

(async () => {
  // 1. Combos (tipoCurso,horario) de los beneficiarios de ENERO.
  const benefCombos = (await pool.query(
    `SELECT "tipoCurso","horarioCurso", COUNT(*)::int n
       FROM "PEOPLE" WHERE "campaign"=$1 AND "tipoUsuario"='BENEFICIARIO'
      GROUP BY "tipoCurso","horarioCurso"`, [FROM])).rows;

  // 2. Cursos existentes en ABRIL.
  const abrilCursos = (await pool.query(`SELECT "tipoCurso","horarioCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1`, [DEST])).rows;
  const abrilSet = new Set(abrilCursos.map(r => `${r.tipoCurso}||${r.horarioCurso}`));
  const maxSalonPorTipo = {};
  for (const r of abrilCursos) { const s = parseInt(r.salon || '0', 10) || 0; if (s > (maxSalonPorTipo[r.tipoCurso] || 0)) maxSalonPorTipo[r.tipoCurso] = s; }

  // 3. Cursos que FALTAN en ABRIL → hay que crearlos.
  const faltantes = [];
  for (const c of benefCombos) {
    const k = `${c.tipoCurso}||${c.horarioCurso}`;
    if (!abrilSet.has(k)) {
      const nextSalon = (maxSalonPorTipo[c.tipoCurso] || 0) + 1;
      maxSalonPorTipo[c.tipoCurso] = nextSalon;
      faltantes.push({ tipoCurso: c.tipoCurso, horarioCurso: c.horarioCurso, salon: String(nextSalon).padStart(2, '0'), inicioCurso: ABRIL.inicioCurso, duracionCurso: ABRIL.duracion, numeroUsuarios: ABRIL.cupos, guia: null, activa: true });
    }
  }

  console.log(`\n══ Mover ${FROM} → ${DEST} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ══\n`);
  console.log(`Cursos a CREAR en ${DEST} (horarios que enero tenía y abril no):`);
  faltantes.forEach(f => console.log(`  + ${f.tipoCurso} ${f.horarioCurso}  salón ${f.salon}`));
  if (!faltantes.length) console.log('  (ninguno)');

  const totalBenef = benefCombos.reduce((a, c) => a + c.n, 0);
  console.log(`\nBeneficiarios a mover: ${totalBenef}\n`);

  if (!APPLY) {
    benefCombos.forEach(c => console.log(`  ${c.n}×  ${c.tipoCurso} ${c.horarioCurso}`));
    console.log('\n(dry-run — nada escrito. Agrega --apply.)');
    await pool.end(); return;
  }

  // 4. Crear los cursos faltantes en ABRIL (upsert + genera eventos).
  if (faltantes.length) {
    await login();
    const res = await fetch(`${BASE}/api/postgres/campaigns`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie() },
      body: JSON.stringify({ campaign: DEST, inicioCampania: ABRIL.inicioCampania, finalCampaign: ABRIL.finalCampaign, cursos: faltantes }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`No se pudieron crear los cursos faltantes: [${res.status}] ${j.error || JSON.stringify(j)}`);
    console.log(`✓ cursos faltantes creados en ${DEST} (${j.creados ?? '?'})`);
  }

  // 5. Mover cada beneficiario.
  const benefs = (await pool.query(
    `SELECT "_id","numeroId","tipoCurso","horarioCurso","salon","primerNombre","primerApellido"
       FROM "PEOPLE" WHERE "campaign"=$1 AND "tipoUsuario"='BENEFICIARIO'`, [FROM])).rows;
  let movidos = 0, fallidos = 0;
  for (const b of benefs) {
    const destC = (await pool.query(`SELECT "_id","salon" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`, [DEST, b.tipoCurso, b.horarioCurso])).rows[0];
    if (!destC) { console.log(`  ✗ ${b.primerNombre} ${b.primerApellido}: sin curso destino ${b.tipoCurso} ${b.horarioCurso}`); fallidos++; continue; }
    const oldC = (await pool.query(`SELECT "_id" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1 AND "tipoCurso"=$2 AND "horarioCurso"=$3 LIMIT 1`, [FROM, b.tipoCurso, b.horarioCurso])).rows[0];
    if (oldC) await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos"=GREATEST(0,COALESCE("usuInscritos",0)-1),"_updatedDate"=NOW() WHERE "_id"=$1`, [oldC._id]);
    await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos"=COALESCE("usuInscritos",0)+1,"_updatedDate"=NOW() WHERE "_id"=$1`, [destC._id]);
    await pool.query(`UPDATE "PEOPLE" SET "campaign"=$2,"salon"=$3,"_updatedDate"=NOW() WHERE "_id"=$1`, [b._id, DEST, destC.salon]);
    await pool.query(`UPDATE "ACADEMICA" SET "campaign"=$2,"salon"=$3,"inicioCurso"=$4::date,"_updatedDate"=NOW() WHERE ("peopleId"=$1 OR "numeroId"=$5)`, [b._id, DEST, destC.salon, ABRIL.inicioCurso, b.numeroId]);
    movidos++;
  }
  console.log(`\nListo. Movidos: ${movidos} · Fallidos: ${fallidos} · (ENERO172026 conserva sus cursos)`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
