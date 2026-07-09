/**
 * Migración de contratos MOSAICO desde CSV (docs/cargaContratoMosaico_extraido_consolidado_completado.csv).
 *
 * Reusa el endpoint probado POST /api/admin/migrar-contrato → createFullContract
 * (PEOPLE titular + beneficiarios, ACADEMICA WELCOME inactiva, USUARIOS_ROLES
 * bloqueado, cupos CURSOS_CAMPAIGN, FINANCIEROS + cuota #0). NO reimplementa la
 * lógica de creación — sólo parsea/normaliza el CSV y postea cada contrato.
 *
 * Uso:
 *   node scripts/migrar-contratos-csv.js --campaign=JUNIO082026                 # dry-run (no escribe)
 *   node scripts/migrar-contratos-csv.js --campaign=JUNIO082026 --apply         # crea (login admin)
 *
 * Flags:
 *   --campaign=NOMBRE      (REQUERIDO) campaña de CURSOS_CAMPAIGN (ej. JUNIO082026 / AGOSTO172026)
 *   --base=URL            base del servidor (default http://localhost:3002)
 *   --vigencia=12         meses de vigencia → finalContrato = hoy + vigencia (default 12)
 *   --plataforma=Chile    plataforma del titular (default Chile; país 01 = Chile)
 *   --email= / --password=  credenciales admin para --apply (default admin@mosaico.com / ADMIN_PASSWORD env)
 *   --csv=ruta            CSV (default docs/cargaContratoMosaico_extraido_consolidado_completado.csv)
 *
 * Notas:
 *  - El N° de contrato se toma tal cual del CSV (como Migrar Contrato).
 *  - createFullContract fija fechaContrato = NOW() (la fecha del CSV NO se preserva).
 *  - titular-es-beneficiario se detecta por numeroId normalizado igual al del titular.
 *  - Dry-run valida contra la BD: curso existe en CURSOS_CAMPAIGN y numeroId no está en PEOPLE.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── args ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const APPLY = !!args.apply;
const CAMPAIGN = args.campaign;
const BASE = (args.base || 'http://localhost:3002').replace(/\/$/, '');
const VIGENCIA = String(args.vigencia || '12');
const PLATAFORMA = args.plataforma || 'Chile';
const PLAN_FORZADO = args.plan || null; // Contado|Credito|Colaborador — si no, se deriva de nº cuotas
const EMAIL = args.email || 'admin@mosaico.com';
const PASSWORD = args.password || process.env.ADMIN_PASSWORD || '';
const CSV = args.csv || 'docs/cargaContratoMosaico_extraido_consolidado_completado.csv';

if (!CAMPAIGN) { console.error('❌ Falta --campaign=NOMBRE (ej. --campaign=JUNIO082026)'); process.exit(1); }

// ── helpers de normalización ───────────────────────────────────────────────────
const stripAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normId = s => stripAccents(s).toUpperCase().replace(/[.\s\-_]/g, '').trim();
const clean = s => String(s || '').trim();

function parseFecha(s) { // "1/06/2026" → "2026-06-01"
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const TIPOS = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'];
function normPrograma(s) {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z]/g, '');
  // Exacto o por prefijo (ej. "IMPULSA PAES" → IMPULSA). Los tipos no son prefijos
  // unos de otros, así que startsWith es seguro.
  return TIPOS.find(t => t === u) || TIPOS.find(t => u.startsWith(t)) || null;
}

function normHorario(s) { // "Martes y Jueves 18:15-19:15" → "MAR-JUE 18:15-19:15"
  const t = stripAccents(s).toLowerCase();
  let days = null;
  if (/lun/.test(t) && /mie/.test(t) && /vie/.test(t)) days = 'LUN-MIÉ-VIE';
  else if (/lun/.test(t) && /mie/.test(t)) days = 'LUN-MIÉ';
  else if (/mar/.test(t) && /jue/.test(t)) days = 'MAR-JUE';
  else if (/sab/.test(t)) days = 'SÁB';
  const times = [...t.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!days || times.length < 2) return null;
  return `${days} ${times[0]}-${times[1]}`;
}

// ── CSV ────────────────────────────────────────────────────────────────────────
const raw = fs.readFileSync(path.resolve(CSV), 'utf8').replace(/^﻿/, '');
const lines = raw.split(/\r?\n/).filter(l => l.trim());
const H = lines[0].split(';').map(clean);
const col = (row, name) => { const i = H.indexOf(name); return i >= 0 ? clean(row[i]) : ''; };

function buildBenef(row, n) {
  const prog = col(row, `programa${n}beneficiario`);
  if (!prog) return null;
  const tipoCurso = normPrograma(prog);
  let horarioCurso = normHorario(col(row, `horario${n}beneficiario`));
  // IMPULSA tiene un único horario en la campaña; si el CSV no lo trae, se defaultea.
  if (tipoCurso === 'IMPULSA' && !horarioCurso) horarioCurso = 'LUN-MIÉ-VIE 20:00-21:00';
  return {
    _idx: n,
    primerNombre: col(row, `nombre1beneciciario${n}`),
    segundoNombre: col(row, `nombre2beneficiario${n}`) || null,
    primerApellido: col(row, `apellido1beneficiario${n}`),
    segundoApellido: col(row, `apellido2beneficiario${n}`) || null,
    numeroId: normId(col(row, `idbeneficiaio${n}`)),
    numeroIdRaw: col(row, `idbeneficiaio${n}`),
    fechaNacimiento: parseFecha(col(row, `fechanacimientobeneficiario${n}`)),
    domicilio: col(row, `domiciliobeneficiaio${n}`) || null,
    email: col(row, `emailbeneficiaio${n}`) || null,
    celular: col(row, `celularbeneficiario${n}`) || null,
    tipoCurso,
    tipoCursoRaw: prog,
    horarioCurso,
    horarioRaw: col(row, `horario${n}beneficiario`),
  };
}

const contratos = lines.slice(1).map(l => {
  const row = l.split(';');
  const apoderado = col(row, 'apoderadoNombre') || null;
  const apoderadoTelefono = col(row, 'apoderadoTelefono') || null;
  const titularId = normId(col(row, 'idTitular'));

  const financieroTotal = col(row, 'totalplan');
  const cuotas = parseInt(col(row, 'nocuotas') || '0', 10) || 0;
  const saldo = Number(String(col(row, 'saldoplan')).replace(/\D/g, '')) || 0;
  const financial = {
    totalPlan: col(row, 'totalplan') || '0',
    pagoInscripcion: col(row, 'inscripcion') || '0',
    saldo: col(row, 'saldoplan') || '0',
    numeroCuotas: String(cuotas),
    valorCuota: cuotas > 0 ? String(Math.round(saldo / cuotas)) : '0',
    plan: PLAN_FORZADO || (cuotas > 1 ? 'Credito' : 'Contado'),
    vigencia: VIGENCIA,
  };

  const titular = {
    primerNombre: col(row, 'primerNombreTitular'),
    segundoNombre: col(row, 'segundoNombreTitular') || null,
    primerApellido: col(row, 'primerApellidoTitular'),
    segundoApellido: col(row, 'segundoApellidoTitular') || null,
    numeroId: titularId,
    numeroIdRaw: col(row, 'idTitular'),
    fechaNacimiento: parseFecha(col(row, 'nacimientoTitular')),
    domicilio: col(row, 'domicilioTitular') || null,
    celular: col(row, 'celularTitular') || null,
    ingresos: col(row, 'ingresoTitular') || null,
    empresa: col(row, 'empresaTitular') || null,
    cargo: col(row, 'cargoTitular') || null,
    plataforma: PLATAFORMA,
    asesor: col(row, 'asesorComercial') || null,
    asesorMail: null,
    apoderado, apoderadoTelefono, apoderadoMail: null,
    esCursoImpulsa: false,
    extemporanea: false,
    email: null,
  };

  let benefs = [buildBenef(row, 1), buildBenef(row, 2)].filter(Boolean);
  // apoderado por beneficiario (mismo del contrato)
  benefs.forEach(b => { b.apoderado = apoderado; b.apoderadoTelefono = apoderadoTelefono; b.apoderadoMail = null; b.campaign = CAMPAIGN; });

  // titular-es-beneficiario: si un beneficiario tiene el mismo numeroId del titular
  let titularEsBeneficiario = false;
  const idxSelf = benefs.findIndex(b => b.numeroId && b.numeroId === titularId);
  if (idxSelf >= 0) {
    const self = benefs[idxSelf];
    titularEsBeneficiario = true;
    titular.tipoCurso = self.tipoCurso;
    titular.horarioCurso = self.horarioCurso;
    titular.campaign = CAMPAIGN;
    titular.email = self.email || titular.email;
    titular.domicilio = titular.domicilio || self.domicilio;
    benefs.splice(idxSelf, 1); // createFullContract lo re-agrega desde el titular
  }

  return { contrato: col(row, 'noContrato'), fechaContratoCSV: col(row, 'fechaContrato'),
           titular, financial, beneficiarios: benefs, titularEsBeneficiario };
});

// ── validación contra la BD (dry-run y apply) ───────────────────────────────────
async function validar(pool) {
  // combos de curso válidos de la campaña
  const cc = await pool.query(
    `SELECT "tipoCurso","horarioCurso","salon" FROM "CURSOS_CAMPAIGN" WHERE "campaign"=$1`, [CAMPAIGN]);
  const cursoSet = new Map(cc.rows.map(r => [`${r.tipoCurso}||${r.horarioCurso}`, r.salon]));
  // numeroIds ya existentes en PEOPLE
  const allIds = [...new Set(contratos.flatMap(c =>
    [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean)))];
  const ex = await pool.query(`SELECT DISTINCT "numeroId" FROM "PEOPLE" WHERE "numeroId" = ANY($1)`, [allIds]);
  const existentes = new Set(ex.rows.map(r => r.numeroId));

  let flags = 0;
  for (const c of contratos) {
    const issues = [];
    const cursos = [];
    if (titularEnCurso(c)) cursos.push({ who: 'titular', ...pickCurso(c.titular) });
    c.beneficiarios.forEach(b => cursos.push({ who: `benef${b._idx}`, tipoCurso: b.tipoCurso, horarioCurso: b.horarioCurso, tipoCursoRaw: b.tipoCursoRaw, horarioRaw: b.horarioRaw, email: b.email, numeroId: b.numeroId }));
    for (const cu of cursos) {
      if (!cu.tipoCurso) issues.push(`❌ curso no reconocido (${cu.tipoCursoRaw})`);
      else if (!cu.horarioCurso) issues.push(`❌ horario no reconocido (${cu.horarioRaw})`);
      else if (!cursoSet.has(`${cu.tipoCurso}||${cu.horarioCurso}`)) issues.push(`❌ ${cu.tipoCurso} ${cu.horarioCurso} NO existe en campaña ${CAMPAIGN}`);
      if (cu.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cu.email)) issues.push(`⚠ email inválido (${cu.who}): ${cu.email}`);
    }
    // numeroId ya existente (salvo el par titular==benef que ya excluimos)
    const ids = [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean);
    ids.forEach(id => { if (existentes.has(id)) issues.push(`❌ numeroId ya existe en PEOPLE: ${id}`); });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) issues.push(`❌ numeroId duplicado en el contrato: ${dup}`);

    c._issues = issues;
    if (issues.length) flags += issues.length;
  }
  return flags;
}
const titularEnCurso = c => c.titularEsBeneficiario;
const pickCurso = t => ({ tipoCurso: t.tipoCurso, horarioCurso: t.horarioCurso, tipoCursoRaw: t.tipoCurso, horarioRaw: t.horarioCurso, email: t.email, numeroId: t.numeroId });

function imprimir() {
  console.log(`\n══════ MIGRACIÓN DE CONTRATOS (campaña ${CAMPAIGN}, ${APPLY ? 'APPLY' : 'DRY-RUN'}) ══════\n`);
  for (const c of contratos) {
    console.log(`● ${c.contrato}  (firma CSV ${c.fechaContratoCSV} — se guardará como hoy)`);
    console.log(`  Titular: ${c.titular.primerNombre} ${c.titular.primerApellido} [${c.titular.numeroIdRaw}→${c.titular.numeroId}]${c.titularEsBeneficiario ? `  ★ titular-es-beneficiario (${c.titular.tipoCurso} ${c.titular.horarioCurso})` : ''}`);
    c.beneficiarios.forEach(b => console.log(`  Benef${b._idx}: ${b.primerNombre} ${b.primerApellido} [${b.numeroIdRaw}→${b.numeroId}] → ${b.tipoCurso} ${b.horarioCurso}  ${b.email || '(sin email)'}`));
    console.log(`  Apoderado: ${c.titular.apoderado || '—'} ${c.titular.apoderadoTelefono || ''}   Asesor: ${c.titular.asesor || '—'}`);
    console.log(`  $ total=${c.financial.totalPlan} insc=${c.financial.pagoInscripcion} saldo=${c.financial.saldo} cuotas=${c.financial.numeroCuotas} valorCuota=${c.financial.valorCuota} plan=${c.financial.plan}`);
    if (c._issues && c._issues.length) c._issues.forEach(x => console.log(`     ${x}`));
    else console.log('     ✓ sin observaciones');
    console.log('');
  }
}

// ── NextAuth login + POST (sólo --apply) ─────────────────────────────────────────
const cookieJar = {};
function setCookies(res) { (res.headers.getSetCookie?.() || []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); cookieJar[kv.slice(0, i)] = kv.slice(i + 1); }); }
const cookieHeader = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');

async function login() {
  if (!PASSWORD) throw new Error('Falta --password= (o ADMIN_PASSWORD en .env.local) para --apply');
  let r = await fetch(`${BASE}/api/auth/csrf`); setCookies(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: 'true' }),
  });
  setCookies(r);
  const s = await fetch(`${BASE}/api/auth/session`, { headers: { Cookie: cookieHeader() } }).then(x => x.json());
  if (!s?.user?.email) throw new Error('Login falló (revisa credenciales)');
  console.log(`🔑 login OK como ${s.user.email} (${s.user.role})`);
}

async function postContrato(c) {
  const body = {
    contrato: c.contrato, titular: c.titular, financial: c.financial,
    beneficiarios: c.beneficiarios, titularEsBeneficiario: c.titularEsBeneficiario,
  };
  const r = await fetch(`${BASE}/api/admin/migrar-contrato`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
  const flags = await validar(pool);
  await pool.end();
  imprimir();

  const bloqueantes = contratos.filter(c => (c._issues || []).some(x => x.startsWith('❌'))).length;
  console.log(`Resumen: ${contratos.length} contratos · ${flags} observaciones · ${bloqueantes} con errores bloqueantes (❌).`);

  if (!APPLY) { console.log('\n(dry-run — nada escrito. Agrega --apply para crear.)'); return; }
  if (bloqueantes > 0) { console.log('\n⛔ Hay contratos con errores bloqueantes (❌). Corrige el CSV antes de --apply.'); process.exit(1); }

  await login();
  console.log('\n── Creando contratos ──');
  for (const c of contratos) {
    const { ok, status, j } = await postContrato(c);
    console.log(ok ? `  ✓ ${c.contrato}: ${j.message || 'creado'} (benef: ${j.beneficiariosCreados ?? '?'})`
                   : `  ✗ ${c.contrato}: [${status}] ${j.error || JSON.stringify(j)}`);
  }
  console.log('\nListo.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
