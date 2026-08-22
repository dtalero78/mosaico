/**
 * Mueve el CIERRE DE MATRÍCULA de una campaña.
 *
 * El corte no es `finalCampaign`: es `finalCampaign + 7 días a las 09:00` (hora de
 * Chile). Este script recibe la fecha en que se quiere que la campaña pase a
 * ACTIVA y calcula hacia atrás el `finalCampaign` que hay que guardar, para no
 * tener que hacer la resta a mano y equivocarse de dos días.
 *
 * Sólo toca `finalCampaign`, que es un dato de matrícula: NO regenera el
 * calendario. Las fechas de las clases salen de `inicioCurso`/`finalCurso`/
 * `horarioCurso` y no se tocan.
 *
 * Uso:
 *   node scripts/ajustar-cierre-matricula.js --campana=AGOSTO172026M --activa=2026-08-24 [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const GRACIA_DIAS = 7;          // debe coincidir con GRACIA_MATRICULA_DIAS
const HORA_CIERRE = '09:00';    // debe coincidir con HORA_CIERRE_MATRICULA
const TZ = 'America/Santiago';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const APPLY = process.argv.includes('--apply');
const CAMPANA = arg('campana');
const ACTIVA = arg('activa');

if (!CAMPANA || !/^\d{4}-\d{2}-\d{2}$/.test(ACTIVA || '')) {
  console.error('\n  Uso: node scripts/ajustar-cierre-matricula.js --campana=NOMBRE --activa=YYYY-MM-DD [--apply]\n');
  process.exit(1);
}

const addDias = (iso, n) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
};
const ahoraChile = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date()).replace(' ', 'T');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const nuevo = addDias(ACTIVA, -GRACIA_DIAS);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int n, MIN("finalCampaign")::text mn, MAX("finalCampaign")::text mx
       FROM "CURSOS_CAMPAIGN" WHERE "campaign" = $1`, [CAMPANA]);
  const r = rows[0];
  if (!r.n) { console.error(`\n  No hay cursos en la campaña ${CAMPANA}.\n`); process.exit(1); }

  const actual = String(r.mn).slice(0, 10);
  const distintos = String(r.mn).slice(0, 10) !== String(r.mx).slice(0, 10);
  const corteActual = addDias(actual, GRACIA_DIAS) + ' ' + HORA_CIERRE;
  const corteNuevo = ACTIVA + ' ' + HORA_CIERRE;

  console.log(`\n  ${CAMPANA} — ${r.n} curso(s)`);
  if (distintos) console.log(`  ⚠ los cursos NO comparten finalCampaign (${r.mn} … ${r.mx}); quedarán todos igual`);
  console.log('  ──────────────────────────────────────────────');
  console.log(`  finalCampaign   ${actual}  →  ${nuevo}`);
  console.log(`  pasa a ACTIVA   ${corteActual}  →  ${corteNuevo}  (hora de Chile)`);
  console.log(`  ahora en Chile  ${ahoraChile().replace('T', ' ')}`);
  console.log(`  estado tras el cambio: ${ahoraChile() < ACTIVA + 'T' + HORA_CIERRE ? 'EN MATRÍCULA' : 'Activo'}`);

  if (!APPLY) { console.log('\n  Dry-run. Correr con --apply para guardarlo.\n'); await pool.end(); return; }

  const upd = await pool.query(
    `UPDATE "CURSOS_CAMPAIGN" SET "finalCampaign" = $2::date, "_updatedDate" = NOW()
      WHERE "campaign" = $1`, [CAMPANA, nuevo]);
  console.log(`\n  ${upd.rowCount} curso(s) actualizados.\n`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
