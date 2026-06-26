/**
 * MOSAICO — campos de curso para el flujo Contrato → Academica → Booking.
 *
 * ACADEMICA: + "campaign", "curso", "inicioCurso"
 *   - campaign / curso: copiados del beneficiario en PEOPLE (campaign / tipoCurso).
 *   - inicioCurso: fecha de inicio del curso (de CURSOS_CAMPAIGN) — la usa el cron
 *     diario que activa el registro 1 semana antes (estadoInactivo=false).
 *   (nivel, step, peopleId, usuarioId ya existen.)
 *
 * NIVELES: + "curso"
 *   - Llave para resolver nivel/step por curso al crear el ACADEMICA del beneficiario.
 *     NIVELES está vacío en MOSAICO; el llenado se define en un paso posterior, por
 *     eso por ahora nivel/step quedarán en blanco si no hay fila de NIVELES.
 *
 * Uso: node scripts/add-academica-curso-fields.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "campaign" VARCHAR(255)`);
    console.log('  ✓ ACADEMICA."campaign" VARCHAR(255)');
    await pool.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "curso" VARCHAR(100)`);
    console.log('  ✓ ACADEMICA."curso" VARCHAR(100)');
    await pool.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "inicioCurso" DATE`);
    console.log('  ✓ ACADEMICA."inicioCurso" DATE');
    await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "curso" VARCHAR(100)`);
    console.log('  ✓ NIVELES."curso" VARCHAR(100)');
    console.log('✅ Columnas de curso listas (ACADEMICA + NIVELES).');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
