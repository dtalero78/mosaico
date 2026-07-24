/**
 * Crea la campaña ENERO172026 con los cursos que requieren los contratos de enero.
 *
 * Decisiones (usuario, 2026-07-23):
 *  - Fechas REALES: inicio de curso 17-ene-2026 (la campaña ya arrancó; los eventos
 *    de los meses pasados se generan igual, reflejando la historia).
 *  - Se crean los horarios TAL COMO SE VENDIERON, incluidos los que no existen en
 *    otras campañas: SÁB 10:00-12:00 y SENPAI MAR-JUE 19:00-19:50.
 *  - Duración por tipo (patrón JUNIO082026): KODOMO/OKINA/YOJI 10 meses,
 *    DANSHI/SENPAI 7. Cupos 12. Salón correlativo por tipo de curso.
 *
 * Usa el endpoint POST /api/postgres/campaigns (mismo que la UI "Crea Campaña"),
 * que además GENERA los eventos del calendario de cada curso.
 *
 * Uso:
 *   node scripts/crear-campana-enero2026.js                 # dry-run (muestra el plan)
 *   node scripts/crear-campana-enero2026.js --apply         # crea (login admin)
 *   flags: --base=http://localhost:3001 --email= --password=
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = !!args.apply;
const BASE = (args.base || 'http://localhost:3001').replace(/\/$/, '');
const EMAIL = args.email || 'admin@mosaico.com';
const PASSWORD = args.password || process.env.ADMIN_PASSWORD || '';
const CSV = args.csv || 'Contratos MOSAICO2026/contratosenero2026.csv';

const CAMPAIGN = 'ENERO172026';
const INICIO_CURSO = '2026-01-17';
const INICIO_CAMPANIA = '2025-12-01'; // apertura de matrícula
const FINAL_CAMPAIGN  = '2026-01-16'; // cierre de matrícula (víspera del inicio)
const CUPOS = 12;
const DURACION = { KODOMO: 10, OKINA: 10, YOJI: 10, DANSHI: 7, SENPAI: 7, IMPULSA: 7 };

// ── leer los combos curso||horario que pide el CSV ────────────────────────────
const stripA = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const TIPOS = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'];
const normP = s => { const u = stripA(s).toUpperCase().replace(/[^A-Z]/g, ''); return TIPOS.find(t => t === u) || TIPOS.find(t => u.startsWith(t)) || null; };
function normHorario(s) {
  const t = stripA(s).toLowerCase(); let d = null;
  if (/lun/.test(t) && /mie/.test(t) && /vie/.test(t)) d = 'LUN-MIÉ-VIE';
  else if (/lun/.test(t) && /mie/.test(t)) d = 'LUN-MIÉ';
  else if (/mar/.test(t) && /jue/.test(t)) d = 'MAR-JUE';
  else if (/sab/.test(t)) d = 'SÁB';
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!d || times.length < 2) return null;
  return `${d} ${times[0]}-${times[1]}`;
}

const buf = fs.readFileSync(path.resolve(CSV));
const raw = (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
  ? buf.slice(3).toString('utf8')
  : (() => { const u = buf.toString('utf8'); return u.includes('�') ? buf.toString('latin1') : u; })();
const lines = raw.split(/\r?\n/).filter(l => l.trim());
const H = lines[0].split(';').map(s => s.trim());
const col = (r, n) => { const i = H.indexOf(n); return i >= 0 ? (r[i] || '').trim() : ''; };

const combos = new Map(); // "TIPO||HORARIO" → nº de alumnos
for (const l of lines.slice(1)) {
  const r = l.split(';');
  for (const n of [1, 2]) {
    const p = col(r, `programa${n}beneficiario`);
    if (!p) continue;
    const t = normP(p);
    let h = normHorario(col(r, `horario${n}beneficiario`));
    if (t === 'IMPULSA' && !h) h = 'LUN-MIÉ-VIE 20:00-21:00';
    if (!t || !h) { console.warn(`⚠ combo no reconocido: "${p}" / "${col(r, `horario${n}beneficiario`)}"`); continue; }
    const k = `${t}||${h}`;
    combos.set(k, (combos.get(k) || 0) + 1);
  }
}

// ── armar los cursos (salón correlativo por tipo) ─────────────────────────────
const porTipo = new Map();
for (const k of combos.keys()) {
  const [tipo, horario] = k.split('||');
  if (!porTipo.has(tipo)) porTipo.set(tipo, []);
  porTipo.get(tipo).push(horario);
}
const cursos = [];
for (const tipo of TIPOS) {
  const horarios = (porTipo.get(tipo) || []).sort();
  horarios.forEach((horarioCurso, i) => {
    cursos.push({
      tipoCurso: tipo,
      horarioCurso,
      salon: String(i + 1).padStart(2, '0'),
      guia: null,                    // se asigna después desde la UI
      numeroUsuarios: CUPOS,
      inicioCurso: INICIO_CURSO,
      duracionCurso: DURACION[tipo] ?? 10,
      activa: true,
    });
  });
}

console.log(`\n══ Campaña ${CAMPAIGN} — ${cursos.length} cursos (${APPLY ? 'APPLY' : 'DRY-RUN'}) ══`);
console.log(`   inicio curso ${INICIO_CURSO} · matrícula ${INICIO_CAMPANIA} → ${FINAL_CAMPAIGN} · cupos ${CUPOS}\n`);
for (const c of cursos) {
  const alumnos = combos.get(`${c.tipoCurso}||${c.horarioCurso}`) || 0;
  console.log(`  ${c.tipoCurso.padEnd(7)} salón ${c.salon}  ${c.horarioCurso.padEnd(22)} ${c.duracionCurso} meses   (${alumnos} alumno(s) del CSV)`);
}

if (!APPLY) { console.log('\n(dry-run — nada creado. Agrega --apply)'); process.exit(0); }

// ── login + POST ──────────────────────────────────────────────────────────────
const jar = {};
const setC = res => (res.headers.getSetCookie?.() || []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); });
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

(async () => {
  if (!PASSWORD) throw new Error('Falta --password= (o ADMIN_PASSWORD en .env.local)');
  let r = await fetch(`${BASE}/api/auth/csrf`); setC(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true' }),
  });
  setC(r);
  const s = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookie() } }).then(x => x.json());
  if (!s?.user?.email) throw new Error('Login falló');
  console.log(`\n🔑 login OK como ${s.user.email} (${s.user.role})`);

  const res = await fetch(`${BASE}/api/postgres/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie() },
    body: JSON.stringify({ campaign: CAMPAIGN, inicioCampania: INICIO_CAMPANIA, finalCampaign: FINAL_CAMPAIGN, cursos }),
  });
  const j = await res.json().catch(() => ({}));
  console.log(res.ok ? `✓ ${j.message || 'creada'} (cursos: ${j.creados ?? '?'})` : `✗ [${res.status}] ${j.error || JSON.stringify(j)}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
