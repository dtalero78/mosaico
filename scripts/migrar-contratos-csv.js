/**
 * Migración de contratos MOSAICO desde CSV.
 *
 * Reusa el endpoint probado POST /api/admin/migrar-contrato → createFullContract
 * (PEOPLE titular + beneficiarios, ACADEMICA WELCOME inactiva, USUARIOS_ROLES
 * bloqueado, cupos CURSOS_CAMPAIGN, FINANCIEROS + cuota #0). NO reimplementa la
 * lógica de creación — sólo parsea/normaliza el CSV y postea cada contrato.
 *
 * Campaña: por defecto se toma de la COLUMNA `campaign` de cada fila y se normaliza
 * (JUNIO*→JUNIO082026, AGOSTO*→AGOSTO172026; IMPULSA sin campaña → AGOSTO172026,
 * única campaña con IMPULSA). Con `--campaign=NOMBRE` se fuerza una sola campaña
 * para todas las filas (modo anterior).
 *
 * Uso:
 *   node scripts/migrar-contratos-csv.js --csv=docs/cargaContratoMosaico_MAYO.csv            # dry-run
 *   node scripts/migrar-contratos-csv.js --csv=docs/cargaContratoMosaico_MAYO.csv --apply    # crea (login admin)
 *
 * Flags:
 *   --campaign=NOMBRE     (opcional) fuerza una campaña para todas las filas
 *   --base=URL            base del servidor (default http://localhost:3002)
 *   --vigencia=12         meses de vigencia → finalContrato = hoy + vigencia (default 12)
 *   --plataforma=Chile    plataforma del titular (default Chile; país 01 = Chile)
 *   --plan=Contado|Credito|Colaborador  fuerza el plan (si no, se deriva de nº cuotas)
 *   --email= / --password=  credenciales admin para --apply (default admin@mosaico.com / ADMIN_PASSWORD env)
 *   --csv=ruta            CSV (default docs/cargaContratoMosaico_MAYO.csv)
 *   --only=N-CONTRATO,... limita a ciertos noContrato (para pruebas)
 *
 * Notas:
 *  - El N° de contrato se toma tal cual del CSV (como Migrar Contrato).
 *  - createFullContract fija fechaContrato = NOW() (la fecha del CSV NO se preserva
 *    en la creación; se puede post-procesar aparte si se requiere la fecha real).
 *  - titular-es-beneficiario se detecta por numeroId normalizado igual al del titular.
 *  - Dry-run valida contra la BD: curso existe en la campaña resuelta y numeroId no
 *    está en PEOPLE.
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
const CAMPAIGN_FORZADA = typeof args.campaign === 'string' ? args.campaign : null;
const BASE = (args.base || 'http://localhost:3002').replace(/\/$/, '');
const VIGENCIA = String(args.vigencia || '12');
const PLATAFORMA = args.plataforma || 'Chile';
const PLAN_FORZADO = args.plan || null; // Contado|Credito|Colaborador — si no, se deriva de nº cuotas
const EMAIL = args.email || 'admin@mosaico.com';
const PASSWORD = args.password || process.env.ADMIN_PASSWORD || '';
const CSV = args.csv || 'docs/cargaContratoMosaico_MAYO.csv';
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',').map(s => s.trim())) : null;
// Mapeo extra de campañas del CSV → BD, ej: --campaignMap=ABRIL2026:JUNIO082026,MARZO2026:JUNIO082026
const CAMPAIGN_MAP = {};
if (typeof args.campaignMap === 'string') {
  args.campaignMap.split(',').forEach(pair => {
    const [from, to] = pair.split(':').map(s => s.trim());
    if (from && to) CAMPAIGN_MAP[from.toUpperCase().replace(/[^A-Z0-9]/g, '')] = to;
  });
}

// ── helpers de normalización ───────────────────────────────────────────────────
const stripAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normId = s => stripAccents(s).toUpperCase().replace(/[.\s\-_]/g, '').trim();
const clean = s => String(s || '').trim();

function parseFecha(s) { // "1/06/2026" → "2026-06-01"
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Normaliza el nombre de campaña del CSV al de CURSOS_CAMPAIGN. */
function normCampaign(s) {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (CAMPAIGN_MAP[u]) return CAMPAIGN_MAP[u];
  if (u.startsWith('JUNIO')) return 'JUNIO082026';
  if (u.startsWith('AGOSTO')) return 'AGOSTO172026';
  if (u.startsWith('SINCAMPAIGN') || u.startsWith('SINCANPAIGN')) return 'SINCAMPAIGN'; // typo tolerado
  return null; // basura → queda sin campaña (se omite)
}

const TIPOS = ['YOJI', 'OKINA', 'KODOMO', 'DANSHI', 'SENPAI', 'IMPULSA'];
function normPrograma(s) {
  const u = stripAccents(s).toUpperCase().replace(/[^A-Z]/g, '');
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
// Auto-detección de codificación: hay plantillas en UTF-8 (con BOM EF BB BF) y
// otras en ISO-8859-1 (Latin-1, "Miércoles"/"Sábado" en 0xE9/0xE1). Leer con la
// equivocada rompe acentos y, en UTF-8, deja el BOM (ï»¿) pegado al 1er encabezado
// → la columna noContrato no matchea y TODO sale bloqueado.
const _buf = fs.readFileSync(path.resolve(CSV));
const raw = (_buf[0] === 0xEF && _buf[1] === 0xBB && _buf[2] === 0xBF)
  ? _buf.slice(3).toString('utf8')   // UTF-8 con BOM
  : _buf.toString('latin1');         // ISO-8859-1 (migraciones previas)
const lines = raw.split(/\r?\n/).filter(l => l.trim());
const H = lines[0].split(';').map(clean);
const col = (row, name) => { const i = H.indexOf(name); return i >= 0 ? clean(row[i]) : ''; };

function buildBenef(row, n) {
  const prog = col(row, `programa${n}beneficiario`);
  if (!prog) return null;
  const tipoCurso = normPrograma(prog);
  let horarioCurso = normHorario(col(row, `horario${n}beneficiario`));
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

let contratos = lines.slice(1).map(l => {
  const row = l.split(';');
  const apoderado = col(row, 'apoderadoNombre') || null;
  const apoderadoTelefono = col(row, 'apoderadoTelefono') || null;
  const titularId = normId(col(row, 'idTitular'));

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

  // Campaña: forzada por flag, o de la columna del CSV.
  //  - JUNIO*/AGOSTO* → campaña con fecha; SINCAMPAIGN → IMPULSA=AGOSTO172026, resto=JUNIO082026.
  //  - basura (p.ej. "iere retirar (pendiente)") → null → se omite en validación.
  const campaignRaw = col(row, 'campaign');
  const hasImpulsa = benefs.some(b => b.tipoCurso === 'IMPULSA');
  let campaign = CAMPAIGN_FORZADA || normCampaign(campaignRaw);
  if (campaign === 'SINCAMPAIGN') campaign = hasImpulsa ? 'AGOSTO172026' : 'JUNIO082026';
  else if (!campaign && hasImpulsa) campaign = 'AGOSTO172026';

  benefs.forEach(b => { b.apoderado = apoderado; b.apoderadoTelefono = apoderadoTelefono; b.apoderadoMail = null; b.campaign = campaign; });

  // titular-es-beneficiario: si un beneficiario tiene el mismo numeroId del titular
  let titularEsBeneficiario = false;
  const idxSelf = benefs.findIndex(b => b.numeroId && b.numeroId === titularId);
  if (idxSelf >= 0) {
    const self = benefs[idxSelf];
    titularEsBeneficiario = true;
    titular.tipoCurso = self.tipoCurso;
    titular.horarioCurso = self.horarioCurso;
    titular.campaign = campaign;
    titular.esCursoImpulsa = self.tipoCurso === 'IMPULSA';
    titular.email = self.email || titular.email;
    titular.domicilio = titular.domicilio || self.domicilio;
    benefs.splice(idxSelf, 1); // createFullContract lo re-agrega desde el titular
  }

  return { contrato: col(row, 'noContrato'), fechaContratoCSV: col(row, 'fechaContrato'),
           campaignRaw, campaign, titular, financial, beneficiarios: benefs, titularEsBeneficiario };
});

if (ONLY) contratos = contratos.filter(c => ONLY.has(c.contrato));

// ── validación contra la BD (dry-run y apply) ───────────────────────────────────
async function validar(pool) {
  // combos de curso válidos POR campaña
  const cc = await pool.query(`SELECT "campaign","tipoCurso","horarioCurso","salon" FROM "CURSOS_CAMPAIGN"`);
  const cursoPorCampaign = new Map();
  for (const r of cc.rows) {
    if (!cursoPorCampaign.has(r.campaign)) cursoPorCampaign.set(r.campaign, new Set());
    cursoPorCampaign.get(r.campaign).add(`${r.tipoCurso}||${r.horarioCurso}`);
  }
  // numeroIds ya existentes en PEOPLE
  const allIds = [...new Set(contratos.flatMap(c =>
    [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean)))];
  const ex = await pool.query(`SELECT DISTINCT "numeroId" FROM "PEOPLE" WHERE "numeroId" = ANY($1)`, [allIds]);
  const existentes = new Set(ex.rows.map(r => r.numeroId));
  // noContrato ya existentes
  const contratoNums = [...new Set(contratos.map(c => c.contrato).filter(Boolean))];
  const exc = await pool.query(`SELECT DISTINCT "contrato" FROM "PEOPLE" WHERE "contrato" = ANY($1)`, [contratoNums]);
  const contratosExistentes = new Set(exc.rows.map(r => r.contrato));

  let flags = 0;
  for (const c of contratos) {
    const issues = [];
    const cursoSet = c.campaign ? (cursoPorCampaign.get(c.campaign) || new Set()) : null;

    if (!c.campaign) issues.push(`❌ campaña no resuelta (CSV: "${c.campaignRaw}")`);
    if (!c.contrato || /x{2,}/i.test(c.contrato)) issues.push(`❌ noContrato inválido/placeholder ("${c.contrato}")`);
    else if (contratosExistentes.has(c.contrato)) issues.push(`❌ noContrato ya existe en PEOPLE: ${c.contrato}`);
    if (!c.titular.primerNombre || !c.titular.primerApellido || !c.titular.numeroId) issues.push('❌ titular incompleto (nombre/apellido/id)');

    const cursos = [];
    if (c.titularEsBeneficiario) cursos.push({ who: 'titular', tipoCurso: c.titular.tipoCurso, horarioCurso: c.titular.horarioCurso, tipoCursoRaw: c.titular.tipoCurso, horarioRaw: c.titular.horarioCurso, email: c.titular.email, numeroId: c.titular.numeroId });
    c.beneficiarios.forEach(b => cursos.push({ who: `benef${b._idx}`, tipoCurso: b.tipoCurso, horarioCurso: b.horarioCurso, tipoCursoRaw: b.tipoCursoRaw, horarioRaw: b.horarioRaw, email: b.email, numeroId: b.numeroId }));
    if (cursos.length === 0) issues.push('❌ sin beneficiarios');
    for (const cu of cursos) {
      if (!cu.tipoCurso) issues.push(`❌ curso no reconocido (${cu.who}): "${cu.tipoCursoRaw}"`);
      else if (!cu.horarioCurso) issues.push(`❌ horario no reconocido (${cu.who}): "${cu.horarioRaw}"`);
      else if (cursoSet && !cursoSet.has(`${cu.tipoCurso}||${cu.horarioCurso}`)) issues.push(`❌ ${cu.tipoCurso} ${cu.horarioCurso} NO existe en ${c.campaign} (${cu.who})`);
      if (cu.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cu.email)) issues.push(`⚠ email inválido (${cu.who}): ${cu.email}`);
      if (!cu.email) issues.push(`⚠ sin email (${cu.who})`);
    }
    // numeroId ya existente / duplicado en el contrato
    const ids = [c.titular.numeroId, ...c.beneficiarios.map(b => b.numeroId)].filter(Boolean);
    ids.forEach(id => { if (existentes.has(id)) issues.push(`❌ numeroId ya existe en PEOPLE: ${id}`); });
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) issues.push(`❌ numeroId duplicado en el contrato: ${dup}`);

    c._issues = issues;
    if (issues.length) flags += issues.length;
  }
  return flags;
}

function imprimir() {
  console.log(`\n══════ MIGRACIÓN DE CONTRATOS (${contratos.length} filas, ${APPLY ? 'APPLY' : 'DRY-RUN'}) ══════\n`);
  for (const c of contratos) {
    const errs = (c._issues || []).filter(x => x.startsWith('❌'));
    const warns = (c._issues || []).filter(x => x.startsWith('⚠'));
    const mark = errs.length ? '⛔' : (warns.length ? '⚠️ ' : '✓');
    console.log(`${mark} ${c.contrato}  [${c.campaignRaw} → ${c.campaign || 'SIN CAMPAÑA'}]  (firma CSV ${c.fechaContratoCSV})`);
    console.log(`   Titular: ${c.titular.primerNombre} ${c.titular.primerApellido} [${c.titular.numeroIdRaw}]${c.titularEsBeneficiario ? `  ★ titular-es-beneficiario (${c.titular.tipoCurso} ${c.titular.horarioCurso})` : ''}`);
    c.beneficiarios.forEach(b => console.log(`   Benef${b._idx}: ${b.primerNombre} ${b.primerApellido} [${b.numeroIdRaw}] → ${b.tipoCurso} ${b.horarioCurso} (CSV horario: "${b.horarioRaw}")`));
    console.log(`   $ total=${c.financial.totalPlan} insc=${c.financial.pagoInscripcion} saldo=${c.financial.saldo} cuotas=${c.financial.numeroCuotas} valorCuota=${c.financial.valorCuota} plan=${c.financial.plan}`);
    (c._issues || []).forEach(x => console.log(`      ${x}`));
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

// Post-proceso 1: fechaContrato real del CSV + finalContrato = fecha + 12 meses.
async function fijarFechas(pool, c) {
  const fecha = parseFecha(c.fechaContratoCSV);
  if (!fecha) return false;
  await pool.query(
    `UPDATE "PEOPLE" SET "fechaContrato"=$2::date, "finalContrato"=($2::date + INTERVAL '12 months')::date, "_updatedDate"=NOW() WHERE "contrato"=$1`,
    [c.contrato, fecha]);
  return true;
}

// Post-proceso 2: logins de 2ºs hermanos que comparten email (createFullContract
// dedupe USUARIOS_ROLES por email → el 2º queda sin cuenta). Se le crea una cuenta
// con email SINTÉTICO único (<userLogin>@est.mosaico.cl) y se actualiza ACADEMICA.email
// para que el panel lo resuelva individualmente (PEOPLE.email conserva el del apoderado).
async function fixHermanosSinLogin(pool, contrato) {
  const faltantes = (await pool.query(
    `SELECT a."_id" AS "academicaId", a."userLogin", a."numeroId", a."primerNombre", a."primerApellido"
     FROM "ACADEMICA" a
     WHERE a."contrato"=$1 AND a."userLogin" IS NOT NULL AND a."userLogin" <> ''
       AND NOT EXISTS (SELECT 1 FROM "USUARIOS_ROLES" u WHERE u."userLogin" = a."userLogin")`,
    [contrato])).rows;
  let creados = 0;
  for (const f of faltantes) {
    const synthEmail = `${f.userLogin}@est.mosaico.cl`;
    const uid = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO "USUARIOS_ROLES" ("_id","email","userLogin","nombre","apellido","numberid","contrato","password","rol","activo","origen","_createdDate","_updatedDate")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ESTUDIANTE',false,'ADMIN',NOW(),NOW())
       ON CONFLICT DO NOTHING`,
      [uid, synthEmail, f.userLogin, f.primerNombre || '', f.primerApellido || '', f.numeroId || null, contrato, f.numeroId || '1234']);
    await pool.query(`UPDATE "ACADEMICA" SET "email"=$2, "_updatedDate"=NOW() WHERE "_id"=$1`, [f.academicaId, synthEmail]);
    creados++;
  }
  return creados;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });
  const flags = await validar(pool);
  imprimir();

  const bloqueantes = contratos.filter(c => (c._issues || []).some(x => x.startsWith('❌')));
  console.log(`Resumen: ${contratos.length} contratos · ${flags} observaciones · ${bloqueantes.length} con errores bloqueantes (❌).`);
  if (bloqueantes.length) console.log(`  Bloqueantes: ${bloqueantes.map(c => c.contrato).join(', ')}`);

  if (!APPLY) { await pool.end(); console.log('\n(dry-run — nada escrito. Agrega --apply para crear los que NO tengan ❌.)'); return; }

  await login();
  console.log('\n── Creando contratos (se omiten los que tienen ❌) ──');
  let ok = 0, skip = 0, fail = 0, fechasOk = 0, hermanos = 0;
  for (const c of contratos) {
    if ((c._issues || []).some(x => x.startsWith('❌'))) { console.log(`  ⏭  ${c.contrato}: OMITIDO (errores bloqueantes)`); skip++; continue; }
    const r = await postContrato(c);
    if (r.ok) {
      let extra = '';
      try { if (await fijarFechas(pool, c)) { fechasOk++; extra += ' +fecha'; } } catch (e) { extra += ` (fecha err: ${e.message})`; }
      try { const h = await fixHermanosSinLogin(pool, c.contrato); if (h) { hermanos += h; extra += ` +${h} login(s) hermano`; } } catch (e) { extra += ` (hermano err: ${e.message})`; }
      console.log(`  ✓ ${c.contrato}: ${r.j.message || 'creado'} (benef: ${r.j.beneficiariosCreados ?? '?'})${extra}`); ok++;
    } else { console.log(`  ✗ ${c.contrato}: [${r.status}] ${r.j.error || JSON.stringify(r.j)}`); fail++; }
  }
  await pool.end();
  console.log(`\nListo. Creados: ${ok} · Omitidos: ${skip} · Fallidos: ${fail} · Fechas fijadas: ${fechasOk} · Logins hermanos: ${hermanos}`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
