/**
 * CALENDARIO."guiaAlcance" — el guía DUEÑO del alcance de una graduación.
 *
 * Una graduación convoca a los alumnos de los cursos/salones de un guía. Si luego la
 * dicta OTRO guía (reemplazo), el alcance y el agendamiento se respetan: se siguen
 * resolviendo contra los cursos del guía original. Idempotente.
 *
 *   node scripts/add-calendario-guia-alcance.js            (ensayo)
 *   node scripts/add-calendario-guia-alcance.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
(async () => {
  const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/,''), ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='CALENDARIO' AND column_name='guiaAlcance'`);
  console.log(rows.length ? 'La columna ya existe.' : 'Falta la columna guiaAlcance.');
  if (apply && !rows.length) {
    await pool.query(`SET lock_timeout = '5s'`);
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "guiaAlcance" VARCHAR(255)`);
    await pool.query(
      `UPDATE "CALENDARIO" SET "guiaAlcance" = "advisor" WHERE UPPER(COALESCE("tipo",'')) = 'GRADUACION' AND "guiaAlcance" IS NULL`);
    console.log('Columna creada.');
  } else if (!apply) console.log('Ensayo: use --apply para crearla.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
