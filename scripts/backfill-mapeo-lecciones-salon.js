/**
 * MOSAICO — backfill del mapeo sesión→lección (camino B) para los cursos existentes.
 * Por cada CURSOS_CAMPAIGN: toma las lecciones del curso (NIVELES por orden), las
 * expande con las repeticiones autorizadas (historicRepet) y asigna la i-ésima
 * lección a la i-ésima sesión (por fecha) del salón. Idempotente.
 *
 * Uso: node scripts/backfill-mapeo-lecciones-salon.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

function expandir(base, reps) {
  const seq = [...base];
  for (const rep of reps) {
    const idx = seq.findIndex(l => l.code === rep.modulo && l.step === rep.leccion);
    if (idx >= 0) seq.splice(idx + 1, 0, seq[idx]);
  }
  return seq;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const cursos = await pool.query(`SELECT "_id","tipoCurso","historicRepet" FROM "CURSOS_CAMPAIGN"`);
    let totalSes = 0, cursosConSes = 0;
    for (const cc of cursos.rows) {
      const base = (await pool.query(
        `SELECT "code","step" FROM "NIVELES" WHERE "curso"=$1 ORDER BY "orden" NULLS LAST, "step"`, [cc.tipoCurso]
      )).rows;
      const hist = Array.isArray(cc.historicRepet) ? cc.historicRepet : [];
      const reps = hist.filter(h => h && h.modulo && h.leccion).map(h => ({ modulo: h.modulo, leccion: h.leccion }));
      const seq = expandir(base, reps);
      const ses = (await pool.query(`SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId"=$1 ORDER BY "dia" ASC`, [cc._id])).rows;
      if (ses.length === 0) continue;
      cursosConSes++;
      if (APPLY) {
        for (let i = 0; i < ses.length; i++) {
          const l = seq[i];
          await pool.query(
            `UPDATE "CALENDARIO" SET "leccionOrden"=$2,"sesionModulo"=$3,"sesionLeccion"=$4,"_updatedDate"=NOW() WHERE "_id"=$1`,
            [ses[i]._id, l ? i + 1 : null, (l && l.code) || null, (l && l.step) || null]
          );
        }
      }
      totalSes += ses.length;
    }
    console.log(`${APPLY ? '✅ Mapeadas' : '(dry-run) Se mapearían'} ${totalSes} sesiones en ${cursosConSes} cursos con sesiones.`);
    if (!APPLY) console.log('Re-ejecuta con --apply.');
  } catch (e) {
    console.error('ERROR:', e.message); process.exit(1);
  } finally { await pool.end(); }
})();
