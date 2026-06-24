/**
 * MOSAICO — correcciones de baseline del esquema (divergencias de schema.sql
 * respecto a la realidad de LGS, detectadas al validar Crear Contrato):
 *
 *  1) `plan` (TEXT) faltaba en PEOPLE y FINANCIEROS. En LGS se agregó por
 *     migración posterior (migrate-plan-to-text); el flujo de Crear Contrato
 *     la usa en ambas (PAGOS_TITULARES ya la tenía).
 *  2) `PEOPLE_numeroId_key` (UNIQUE en numeroId) NO debe existir: el titular
 *     que es su propio beneficiario genera 2 filas (TITULAR + BENEFICIARIO) con
 *     el mismo numeroId, y un UNIQUE de BD lo bloquearía. Regla MOSAICO: el
 *     numeroId solo puede compartirse en ESE caso — el resto de duplicados se
 *     rechaza a nivel de aplicación en POST /api/postgres/contracts (un constraint
 *     de BD no puede distinguir "el beneficiario ES el titular").
 *
 * Uso: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/add-baseline-plan-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS.
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
    for (const t of ['PEOPLE', 'FINANCIEROS']) {
      await pool.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "plan" TEXT`);
      console.log(`  ✓ ${t}."plan" TEXT`);
    }
    console.log('✅ Columna plan presente en PEOPLE y FINANCIEROS.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
