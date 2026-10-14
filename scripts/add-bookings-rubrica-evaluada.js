/**
 * ACADEMICA_BOOKINGS."rubricaEvaluada" BOOLEAN (nullable) — marca que el Guía
 * guardó la rúbrica de la sesión (las 9 casillas de "Evaluación de la Sesión"
 * en /sesion/[id]) para un alumno que ASISTIÓ.
 *
 * Hace falta para que el Reporte Académico distinga "no cumplió" de "no se
 * evaluó": los 7 criterios del booking nacen en false, así que sin esta marca
 * una sesión anterior a la rúbrica se leería como "no cumplió nada".
 *
 * Los agendamientos existentes quedan en NULL (nunca se evaluó la rúbrica).
 * ADD COLUMN nullable sin default es sólo un cambio de catálogo: no reescribe
 * la tabla.
 *
 * Uso: node scripts/add-bookings-rubrica-evaluada.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows: col } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'ACADEMICA_BOOKINGS' AND column_name = 'rubricaEvaluada'`
  );
  console.log(`Columna ACADEMICA_BOOKINGS.rubricaEvaluada: ${col.length ? 'ya existe' : 'falta'}`);

  if (!APPLY) {
    console.log('(dry-run) Reejecuta con --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Sin lock_timeout un ALTER encolado detrás de una consulta larga bloquea a
    // toda la aplicación mientras espera.
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "rubricaEvaluada" BOOLEAN`);
    await client.query('COMMIT');
    console.log('✓ ACADEMICA_BOOKINGS.rubricaEvaluada creada (NULL para los agendamientos existentes).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✗', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
