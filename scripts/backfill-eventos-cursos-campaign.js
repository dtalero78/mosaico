/**
 * MOSAICO — backfill: genera los eventos de CALENDARIO para los cursos de campaña
 * YA existentes (los creados antes de la generación automática). Replica la lógica
 * de src/services/cursos-campaign-eventos.service.ts.
 *
 * Idempotente: por cada curso borra sus eventos previos (cursoCampaignId) y reinserta.
 *
 * Uso:  node scripts/backfill-eventos-cursos-campaign.js            (dry-run, cuenta)
 *       node scripts/backfill-eventos-cursos-campaign.js --apply    (genera)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const TZ = 'America/Santiago';
const MAX = 2000;
const DIA = { DOM: 0, LUN: 1, MAR: 2, MIE: 3, 'MIÉ': 3, JUE: 4, VIE: 5, SAB: 6, 'SÁB': 6 };

function parseHorario(h) {
  if (!h) return null;
  const p = String(h).trim().split(/\s+/);
  if (p.length < 2) return null;
  const dias = p[0].split('-').map(d => DIA[d.toUpperCase()]).filter(n => n !== undefined);
  const hora = (p[1].split('-')[0] || '').trim();
  if (dias.length === 0 || !/^\d{1,2}:\d{2}$/.test(hora)) return null;
  return { dias, hora };
}
function fechasEntre(i, f, dias) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i) || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return [];
  const set = new Set(dias); const out = [];
  const [iy, im, id] = i.split('-').map(Number); const [fy, fm, fd] = f.split('-').map(Number);
  let c = Date.UTC(iy, im - 1, id); const e = Date.UTC(fy, fm - 1, fd); let g = 0;
  while (c <= e && g < 4000) { const d = new Date(c); if (set.has(d.getUTCDay())) out.push(d.toISOString().slice(0, 10)); c += 86400000; g++; }
  return out;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const cursos = (await pool.query(
      `SELECT "_id","campaign","tipoCurso","salon","guia","horarioCurso",
              "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso",
              "numeroUsuarios" FROM "CURSOS_CAMPAIGN" ORDER BY "campaign","tipoCurso"`
    )).rows;
    console.log(`Cursos: ${cursos.length}`);
    let total = 0, conEventos = 0, sinFechas = 0;
    for (const c of cursos) {
      const parsed = parseHorario(c.horarioCurso);
      const ini = c.inicioCurso ? c.inicioCurso.slice(0, 10) : '';
      const fin = c.finalCurso ? c.finalCurso.slice(0, 10) : '';
      let fechas = (parsed && ini && fin) ? fechasEntre(ini, fin, parsed.dias) : [];
      if (fechas.length > MAX) fechas = fechas.slice(0, MAX);
      if (fechas.length === 0) { sinFechas++; console.log(`  ⚠ ${c.campaign} / ${c.tipoCurso} / ${c.horarioCurso} → 0 (horario o fechas inválidas)`); continue; }
      conEventos++; total += fechas.length;
      console.log(`  ${c.campaign} / ${c.tipoCurso} / ${c.salon || '—'} / ${c.horarioCurso}: ${fechas.length} eventos (${ini}→${fin})`);

      if (!apply) continue;
      const hora = parsed.hora.length === 4 ? `0${parsed.hora}` : parsed.hora;
      const titulo = [c.campaign, c.tipoCurso, (c.salon || '').trim()].filter(Boolean).join(' - ');
      const advisor = (c.guia || '').trim();
      const limite = Number(c.numeroUsuarios) || 0;
      await pool.query(`DELETE FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [c._id]);
      const cols = '"_id","tipo","evento","fecha","hora","dia","advisor","nivel","titulo","tituloONivel","nombreEvento","limiteUsuarios","cursoCampaignId","inscritos","origen","sesionCerrada","_createdDate","_updatedDate"';
      const params = []; const rows = [];
      fechas.forEach((fecha, r) => {
        const b = r * 11;
        rows.push(`($${b + 1},$${b + 2},$${b + 2},$${b + 3},$${b + 4},($${b + 5}::timestamp AT TIME ZONE '${TZ}'),$${b + 6},$${b + 7},$${b + 8},$${b + 8},$${b + 9},$${b + 10},$${b + 11},0,'POSTGRES',false,NOW(),NOW())`);
        params.push(`evt_${randomUUID()}`, 'SESSION', fecha, hora, `${fecha} ${hora}:00`, advisor, c.tipoCurso, titulo, c.horarioCurso, limite, c._id);
      });
      // 11 params por fila
      await pool.query(`INSERT INTO "CALENDARIO" (${cols}) VALUES ${rows.join(', ')}`, params);
    }
    console.log(`\n${apply ? '✅ GENERADOS' : '(dry-run) generaría'} ${total} eventos en ${conEventos} curso(s). Sin fechas: ${sinFechas}.`);
    if (!apply) console.log('Ejecuta con --apply para escribir.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
