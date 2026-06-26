/**
 * MOSAICO — agrega la columna "userLogin" a PEOPLE, ACADEMICA y USUARIOS_ROLES.
 *
 * Columna nullable VARCHAR(255). Pensada para enlazar/rastrear el usuario de login
 * del beneficiario a través de las tres tablas del flujo contrato → academica →
 * usuarios_roles. El significado exacto del valor se define en el flujo de negocio.
 *
 * Uso: node scripts/add-userlogin-columns.js
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
    for (const t of ['PEOPLE', 'ACADEMICA', 'USUARIOS_ROLES']) {
      await pool.query(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "userLogin" VARCHAR(255)`);
      console.log(`  ✓ ${t}."userLogin" VARCHAR(255)`);
    }
    console.log('✅ Columna userLogin lista en las 3 tablas.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
