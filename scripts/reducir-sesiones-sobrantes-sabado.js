/**
 * Sesiones de sábado que sobran tras repartir dos lecciones por clase.
 *
 * Una clase de dos horas cubre DOS lecciones (`src/lib/bloques-leccion`), así que un
 * curso de sábado termina su currículo con la mitad de sesiones. Las que quedan al
 * final se quedan SIN lección: no hay nada que dictar en ellas.
 *
 * Este script las borra junto con sus agendamientos. **Sólo toca sesiones sin
 * lección, futuras y sin nada registrado** (asistencia, participación, cancelación,
 * no-aprobó o calificación): eso es historia que no se puede reconstruir, y si
 * apareciera una así el script la reporta y no la borra.
 *
 * ⚠ ACORTA EL CURSO. Borrar 14 sábados adelanta el fin del curso ~3 meses y medio.
 * Por eso mueve también `CURSOS_CAMPAIGN.finalCurso` a la fecha de la última sesión
 * que SÍ queda: sin eso, regenerar el curso volvería a crear las sesiones borradas
 * (los eventos se generan desde inicio/final/horario) y esto duraría hasta el
 * siguiente guardado en Campañas.
 *
 * Dry-run por defecto. Uso:
 *   node scripts/reducir-sesiones-sobrantes-sabado.js [--apply] [--campaign=AGOSTO172026M]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const CAMPAIGN = (process.argv.find(a => a.startsWith('--campaign=')) || '').split('=')[1] || null;
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

/** Minutos que dura el horario ("SÁB 09:00-11:00" → 120). */
function duracionMin(horario) {
  const partes = String(horario || '').trim().split(/\s+/);
  if (partes.length < 2) return null;
  const [ini, fin] = (partes[1] || '').split('-').map(s => (s || '').trim());
  const aMin = (h) => { const m = /^(\d{1,2}):(\d{2})$/.exec(h); return m ? +m[1] * 60 + +m[2] : null; };
  const a = aMin(ini), b = aMin(fin);
  return (a === null || b === null || b <= a) ? null : b - a;
}
const esDoble = (h) => (duracionMin(h) || 0) >= 105;

(async () => {
  const { rows: cursos } = await pool.query(
    `SELECT "_id","campaign","tipoCurso","salon","horarioCurso","finalCurso"::text AS "finalCurso"
       FROM "CURSOS_CAMPAIGN"
      WHERE "activa" IS NOT FALSE AND UPPER("tipoCurso") <> 'IMPULSA'
        ${CAMPAIGN ? 'AND "campaign" = $1' : ''}
      ORDER BY "campaign","tipoCurso","salon"`,
    CAMPAIGN ? [CAMPAIGN] : []
  );

  let totSes = 0, totBk = 0, totProtegidas = 0, salones = 0;
  const protegidas = [];
  console.log(`\n  ${APPLY ? 'APLICANDO' : 'DRY-RUN'} — sesiones de sábado sin lección\n`);
  console.log('  ' + 'salón'.padEnd(30) + 'borra  agend.  fin curso: antes → después');

  for (const c of cursos) {
    if (!esDoble(c.horarioCurso)) continue;

    // Sobrantes: sin lección, futuras y sin nada registrado en sus agendamientos.
    const { rows: sobra } = await pool.query(
      `SELECT c."_id", c."fecha"::text AS "fecha",
              (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
                WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")) AS "agend",
              (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
                WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
                  AND (b."asistio" IS TRUE OR b."asistencia" IS TRUE OR b."cancelo" IS TRUE
                       OR b."participacion" IS TRUE OR b."noAprobo" IS TRUE OR b."calificacion" IS NOT NULL)) AS "historia"
         FROM "CALENDARIO" c
        WHERE c."cursoCampaignId" = $1 AND c."sesionLeccion" IS NULL AND c."dia" >= NOW()
        ORDER BY c."dia" ASC`, [c._id]);
    if (!sobra.length) continue;

    const conHistoria = sobra.filter(s => s.historia > 0);
    const borrables = sobra.filter(s => s.historia === 0);
    if (conHistoria.length) {
      totProtegidas += conHistoria.length;
      protegidas.push(...conHistoria.map(s => `${c.campaign} ${c.tipoCurso}/${c.salon} ${s.fecha.slice(0, 10)} (${s.historia} con registro)`));
    }
    if (!borrables.length) continue;

    const nBk = borrables.reduce((a, s) => a + s.agend, 0);
    const ids = borrables.map(s => s._id);

    // Nuevo fin del curso = última sesión que se conserva.
    const { rows: [ult] } = await pool.query(
      `SELECT MAX("fecha")::text AS f FROM "CALENDARIO"
        WHERE "cursoCampaignId" = $1 AND NOT ("_id" = ANY($2::text[]))`, [c._id, ids]);
    const nuevoFin = (ult?.f || '').slice(0, 10) || null;

    salones++; totSes += borrables.length; totBk += nBk;
    console.log('  ' + `${c.campaign} ${c.tipoCurso}/${c.salon}`.padEnd(30) +
      String(borrables.length).padStart(5) + String(nBk).padStart(8) +
      `  ${String(c.finalCurso).slice(0, 10)} → ${nuevoFin || '?'}`);

    if (!APPLY) continue;
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await cli.query(
        `DELETE FROM "ACADEMICA_BOOKINGS" WHERE "eventoId" = ANY($1::text[]) OR "idEvento" = ANY($1::text[])`, [ids]);
      await cli.query(`DELETE FROM "CALENDARIO" WHERE "_id" = ANY($1::text[])`, [ids]);
      if (nuevoFin) {
        await cli.query(`UPDATE "CURSOS_CAMPAIGN" SET "finalCurso" = $2::date, "_updatedDate" = NOW() WHERE "_id" = $1`, [c._id, nuevoFin]);
      }
      await cli.query('COMMIT');
    } catch (e) {
      await cli.query('ROLLBACK');
      console.log(`     ⚠ ERROR, sin cambios: ${e.message}`);
    } finally { cli.release(); }
  }

  console.log(`\n  ${salones} salones · ${totSes} sesiones · ${totBk} agendamientos`);
  if (totProtegidas) {
    console.log(`\n  ⚠ ${totProtegidas} sesión(es) NO se tocan — tienen asistencia u otro registro:`);
    protegidas.forEach(p => console.log('    ' + p));
  }
  console.log(APPLY ? '\n  Aplicado.\n' : '\n  Dry-run. Correr con --apply para ejecutar.\n');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
