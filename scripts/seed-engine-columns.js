/**
 * MOSAICO — barrido de columnas del motor (LGS) que el seed mínimo de mosaico-db
 * no creó en PEOPLE / ACADEMICA. Sin ellas, queries que las nombran explícitamente
 * lanzan "column does not exist" → 500 en distintas pantallas (consentimiento,
 * aprobación, clear-historic, inicializar-nivel, crear-perfil, ESS, etc.).
 *
 * Verificado contra information_schema antes de escribir el script: estas son las
 * que faltaban (las que ya existían no se listan). Idempotente: ADD COLUMN IF NOT EXISTS.
 *
 * Uso: node scripts/seed-engine-columns.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ALTERS = [
  // PEOPLE — consentimiento declarativo (firma OTP del contrato)
  ['PEOPLE', 'consentimientoDeclarativo', 'JSONB'],
  ['PEOPLE', 'hashConsentimiento', 'TEXT'],
  ['PEOPLE', 'numeroDocumentoVerificado', 'VARCHAR(255)'],
  // PEOPLE — contrato / ESS
  ['PEOPLE', 'inicioContrato', 'DATE'],
  ['PEOPLE', 'fechaInicioESS', 'TIMESTAMPTZ'],
  // ACADEMICA — ESS / promoción especial
  ['ACADEMICA', 'fechaInicioESS', 'TIMESTAMPTZ'],
  ['ACADEMICA', 'fechaPromocionEspecial', 'TIMESTAMPTZ'],
  // ACADEMICA — clear-historic / inicializar-nivel (auditoría one-time)
  ['ACADEMICA', 'chkclrhistoric', 'INTEGER'],
  ['ACADEMICA', 'checkinicianivel', 'INTEGER'],
  // ACADEMICA — crear-perfil (/nuevo-usuario)
  ['ACADEMICA', 'detallesPersonales', 'TEXT'],
  ['ACADEMICA', 'hobbies', 'TEXT'],
  ['ACADEMICA', 'foto', 'TEXT'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [tabla, col, tipo] of ALTERS) {
      await pool.query(`ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
      console.log(`  ✓ ${tabla}."${col}" ${tipo}`);
    }
    console.log('✅ Barrido de columnas del motor completado (PEOPLE / ACADEMICA).');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
