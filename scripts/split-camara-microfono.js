/**
 * Separa el criterio «Uso adecuado de cámara y micrófono» en dos:
 *   - Cámara     → sigue en ACADEMICA_BOOKINGS."acDisposicion" (la columna de siempre)
 *   - Micrófono  → columna NUEVA ACADEMICA_BOOKINGS."acMicrofono"
 *
 * Lo ya guardado se COPIA a ambas (decisión del usuario): quien estaba marcado en
 * «cámara y micrófono» queda marcado en las dos, así ningún informe cambia de
 * valor. Igual con las correcciones a mano del Reporte Académico: en
 * REPORTE_ACADEMICO_NOTAS."criterios" se agrega `microfono` con el valor de
 * `camara` donde exista (y no se pisa un `microfono` que ya esté).
 *
 * Idempotente. Con `lock_timeout` para no encolar a producción.
 *
 * Uso: node scripts/split-camara-microfono.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const q = async (s, p = []) => (await pool.query(s, p)).rows;
  const existe = (await q(
    `SELECT 1 FROM information_schema.columns WHERE table_name='ACADEMICA_BOOKINGS' AND column_name='acMicrofono'`
  )).length > 0;

  const [{ n: bookings }] = await q(`SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKINGS" WHERE "acDisposicion" IS TRUE`);
  const [{ n: notas }] = await q(
    `SELECT COUNT(*)::int n FROM "REPORTE_ACADEMICO_NOTAS" WHERE "criterios" ? 'camara' AND NOT ("criterios" ? 'microfono')`
  );
  console.log(`Columna acMicrofono: ${existe ? 'ya existe' : 'se creará'}`);
  console.log(`Agendamientos con cámara y micrófono marcado: ${bookings} (se copian a micrófono)`);
  console.log(`Correcciones del reporte con "camara" sin "microfono": ${notas} (se copian)`);
  if (!APPLY) { console.log('\n(dry-run) Reejecuta con --apply.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    if (!existe) {
      await client.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN "acMicrofono" BOOLEAN DEFAULT false`);
    }
    const b = await client.query(
      `UPDATE "ACADEMICA_BOOKINGS" SET "acMicrofono" = true
        WHERE "acDisposicion" IS TRUE AND "acMicrofono" IS NOT TRUE`
    );
    const n = await client.query(
      `UPDATE "REPORTE_ACADEMICO_NOTAS"
          SET "criterios" = "criterios" || jsonb_build_object('microfono', "criterios"->'camara')
        WHERE "criterios" ? 'camara' AND NOT ("criterios" ? 'microfono')`
    );
    await client.query('COMMIT');
    console.log(`\n✅ ${b.rowCount} agendamiento(s) y ${n.rowCount} corrección(es) copiados a micrófono.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch(async (e) => { console.error('❌', e.message); await pool.end(); process.exit(1); });
