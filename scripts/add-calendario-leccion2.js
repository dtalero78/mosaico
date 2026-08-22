/**
 * `CALENDARIO.sesionModulo2` / `sesionLeccion2` — la SEGUNDA lección de una sesión.
 *
 * Las clases de sábado duran dos horas y cubren dos lecciones, una por bloque.
 * Hasta ahora una sesión llevaba una sola lección, sin importar si duraba una hora
 * o dos, así que los cursos de sábado avanzaban a media velocidad y no alcanzaban
 * a terminar el currículo (YOJI: 48 sesiones para 74 lecciones).
 *
 * Nace en NULL. Una sesión con `sesionLeccion2` vacía es de UNA lección, que es lo
 * que siguen siendo todas las de entre semana y todas las ya dictadas.
 *
 * Idempotente. Uso: node scripts/add-calendario-leccion2.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  for (const col of ['sesionModulo2', 'sesionLeccion2']) {
    const tiene = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='CALENDARIO' AND column_name=$1`, [col]);
    if (tiene.rowCount) console.log(`  ${col}: ya existe`);
    else if (APPLY) {
      await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "${col}" VARCHAR(120)`);
      console.log(`  ${col}: CREADA`);
    } else console.log(`  ${col}: se crearía (VARCHAR(120), nace en NULL)`);
  }

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  console.table((await pool.query(`
    SELECT COUNT(*)::int "eventos de curso",
           COUNT(*) FILTER (WHERE "sesionLeccion2" IS NOT NULL)::int "con 2ª lección",
           COUNT(*) FILTER (WHERE "dia" >= NOW())::int "por dictar"
      FROM "CALENDARIO" WHERE "cursoCampaignId" IS NOT NULL`)).rows);
  console.log('');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
