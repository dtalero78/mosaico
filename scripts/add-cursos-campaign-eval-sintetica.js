/**
 * CURSOS_CAMPAIGN."evalSinteticaPorModulo" — ¿este salón usa la secuencia LEGACY?
 *
 * `Modulo 00` es la INDUCCIÓN del curso (una o dos lecciones de bienvenida), y no
 * se evalúa. El generador de la secuencia metía una evaluación al final de TODOS
 * los módulos, así que a cada salón le salía una "Evaluación de Modulo 00" como
 * segunda o tercera sesión.
 *
 * Quitarla corre la secuencia una posición, y eso re-etiquetaría clases YA
 * DICTADAS en los cursos en marcha (ABRIL/JUNIO llevan 20-36 sesiones). Por eso
 * la decisión se guarda POR SALÓN en vez de ser una regla global: los salones que
 * ya pasaron esa sesión la conservan para siempre — incluso si alguien regenera
 * el curso, que es cuando la regla global los habría corrido en silencio.
 *
 * Backfill: `true` (conserva) si la sesión de evaluación del Modulo 00 ya ocurrió;
 * `false` (se corrige) si aún no. Los cursos nuevos nacen en `false`.
 *
 * Uso: node scripts/add-cursos-campaign-eval-sintetica.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const c = await pool.connect();
  try {
    console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

    // 1) La columna
    const tiene = await c.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='CURSOS_CAMPAIGN' AND column_name='evalSinteticaPorModulo'`);
    if (tiene.rowCount) {
      console.log('  columna evalSinteticaPorModulo: ya existe');
    } else if (APPLY) {
      await c.query(`ALTER TABLE "CURSOS_CAMPAIGN"
        ADD COLUMN IF NOT EXISTS "evalSinteticaPorModulo" BOOLEAN NOT NULL DEFAULT false`);
      console.log('  columna evalSinteticaPorModulo: CREADA (default false)');
    } else {
      console.log('  columna evalSinteticaPorModulo: se crearía (BOOLEAN DEFAULT false)');
    }

    // 2) Qué salones la conservan: los que YA dictaron su evaluación de Modulo 00
    const clasif = await c.query(`
      SELECT cc."campaign", cc."tipoCurso",
             SUM(CASE WHEN e."dia" < NOW() THEN 1 ELSE 0 END)::int conservan,
             SUM(CASE WHEN e."dia" >= NOW() THEN 1 ELSE 0 END)::int se_corrigen
        FROM "CALENDARIO" e
        JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
       WHERE e."sesionLeccion" = 'Evaluación' AND e."sesionModulo" = 'Modulo 00'
       GROUP BY 1,2 ORDER BY 1,2`);
    let tot = { conservan: 0, corrigen: 0 };
    for (const r of clasif.rows) { tot.conservan += r.conservan; tot.se_corrigen += 0; tot.corrigen += r.se_corrigen; }
    console.log(`\n  Salones que CONSERVAN la evaluación (ya la dictaron): ${tot.conservan}`);
    console.log(`  Salones que se CORRIGEN (aún no la dictan):          ${tot.corrigen}`);
    console.table(clasif.rows.filter(r => r.se_corrigen > 0));

    if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); return; }

    const upd = await c.query(`
      UPDATE "CURSOS_CAMPAIGN" cc SET "evalSinteticaPorModulo" = true
       WHERE EXISTS (SELECT 1 FROM "CALENDARIO" e
                      WHERE e."cursoCampaignId" = cc."_id"
                        AND e."sesionLeccion" = 'Evaluación'
                        AND e."sesionModulo" = 'Modulo 00'
                        AND e."dia" < NOW())`);
    console.log(`\n  marcados evalSinteticaPorModulo=true (grandfathering): ${upd.rowCount}`);

    const resumen = await c.query(
      `SELECT "evalSinteticaPorModulo", COUNT(*)::int n FROM "CURSOS_CAMPAIGN" GROUP BY 1 ORDER BY 1`);
    console.table(resumen.rows);
    console.log('');
  } finally {
    c.release();
    await pool.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
