/**
 * MOSAICO — Repara los salones cuyo Ajuste masivo movió a los alumnos pero NO el
 * calendario (el guía seguía viendo la lección vieja). Para cada salón con
 * ajustes "Ajuste masivo" desde --desde (default hoy), toma la lección destino de
 * su ÚLTIMO ajuste y llama a `registrarSaltoSalon` (la misma función del Ajuste
 * masivo). Si el destino no queda por delante de la próxima sesión no se toca
 * (p. ej. un salón movido hacia atrás): se lista aparte.
 *
 * Carga los .ts del repo con un transpilador en memoria (alias @/ y server-only
 * sustituido), así usa el código real y no una copia.
 *
 * Uso: node scripts/reparar-saltos-ajuste-masivo.js [--desde=2026-10-27] [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const path = require('path'), fs = require('fs'), Module = require('module');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env.local') });
const ts = require('typescript');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) {
  if (req === 'server-only') return require.resolve('./_stub-vacio.js');
  if (req.startsWith('@/')) {
    const base = path.join(root, 'src', req.slice(2));
    for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c;
  }
  return origResolve.call(this, req, ...a);
};
require.extensions['.ts'] = (m, file) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: 'commonjs', target: 'es2019', esModuleInterop: true } });
  m._compile(out.outputText, file);
};
const DESDE = (process.argv.find(a => a.startsWith('--desde=')) || '--desde=2026-10-27').split('=')[1];
const APPLY = process.argv.includes('--apply');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const { registrarSaltoSalon } = require(path.join(root, 'src/services/repetir-clase.service.ts'));
  const { rows } = await pool.query(`
    SELECT cc."_id" AS cid, cc.campaign, cc."tipoCurso", cc.salon, e->>'a' a, e->>'fecha' f
      FROM "ACADEMICA" a
      JOIN "PEOPLE" pe ON pe."numeroId"=a."numeroId" AND pe."tipoUsuario"='BENEFICIARIO'
      JOIN "CURSOS_CAMPAIGN" cc ON cc.campaign=pe.campaign AND cc."tipoCurso"=pe."tipoCurso" AND cc."horarioCurso"=pe."horarioCurso",
      jsonb_array_elements(COALESCE(a."cambioStepHistory",'[]'::jsonb)) e
     WHERE e->>'origen'='Ajuste masivo' AND e->>'fecha' >= $1`, [DESDE]);
  const porSalon = new Map();
  for (const r of rows) { const p = porSalon.get(r.cid); if (!p || r.f > p.f) porSalon.set(r.cid, r); }
  console.log(`${porSalon.size} salones con ajuste desde ${DESDE}`);
  const res = { aplicado: [], sinCambio: [] };
  for (const r of porSalon.values()) {
    const [modulo, leccion] = String(r.a).split(' · ').map(s => s.trim());
    const nom = `${r.campaign} · ${r.tipoCurso} · ${r.salon} → ${r.a}`;
    if (!APPLY) { console.log('(ensayo)', nom); continue; }
    const x = await registrarSaltoSalon(r.cid, modulo, leccion, 'script (reparación Ajuste masivo)');
    (x.aplicado ? res.aplicado : res.sinCambio).push(`${nom}${x.desde ? ' desde ' + x.desde : ''}`);
  }
  if (APPLY) {
    console.log(`\n✅ calendario movido en ${res.aplicado.length}:`); res.aplicado.forEach(s => console.log('  ' + s));
    console.log(`\n— sin cambio (destino no queda por delante de la próxima sesión) ${res.sinCambio.length}:`); res.sinCambio.forEach(s => console.log('  ' + s));
  }
  await pool.end(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
