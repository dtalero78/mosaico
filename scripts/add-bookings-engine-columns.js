/**
 * MOSAICO — columnas del motor que el seed mínimo de mosaico-db no creó en ACADEMICA_BOOKINGS.
 *
 * El INSERT del enroll (enrollment.service) y las queries del motor (booking.repository,
 * student-booking, reportes) referencian columnas legacy/extra que el schema.sql semilla no
 * tiene: idEvento, idEstudiante, numeroId, celular, plataforma, fechaEvento, tipoEvento,
 * nombreEvento, tituloONivel, agendadoPor, agendadoPorEmail, agendadoPorRol, fechaAgendamiento.
 * En Postgres, aunque se usen con OR/COALESCE, AMBAS columnas deben existir o la query lanza
 * "column does not exist". Sin ellas, agendar/inscribir falla.
 *
 * Uso: node scripts/add-bookings-engine-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ALTERS = [
  ['idEvento', 'VARCHAR(50)'],
  ['idEstudiante', 'VARCHAR(50)'],
  ['numeroId', 'VARCHAR(255)'],
  ['celular', 'VARCHAR(50)'],
  ['plataforma', 'VARCHAR(100)'],
  ['fechaEvento', 'TIMESTAMPTZ'],
  ['tipoEvento', 'VARCHAR(50)'],
  ['nombreEvento', 'TEXT'],
  ['tituloONivel', 'TEXT'],
  ['agendadoPor', 'VARCHAR(255)'],
  ['agendadoPorEmail', 'VARCHAR(255)'],
  ['agendadoPorRol', 'VARCHAR(100)'],
  ['fechaAgendamiento', 'TIMESTAMPTZ'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, tipo] of ALTERS) {
      await pool.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
      console.log(`  ✓ ACADEMICA_BOOKINGS."${col}" ${tipo}`);
    }
    console.log('✅ Columnas del motor agregadas a ACADEMICA_BOOKINGS.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
