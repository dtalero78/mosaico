/**
 * MOSAICO — agrega columnas legacy de LGS a USUARIOS_ROLES que el seed mínimo no tenía
 * pero que el código usa (ej. el alta de guías /nuevo-guia y otros flujos):
 *   numberid   (numeroId del usuario, para lookups por documento)
 *   contrato   (número de contrato, se llena al registrar estudiantes)
 *   plataforma (país/marca del usuario, usado por scope de Recaudos)
 *
 * Aditivo (ADD COLUMN IF NOT EXISTS). No destructivo.
 * Uso: node scripts/add-usuarios-roles-numberid-columns.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const COLUMNS = [
  ['numberid', 'VARCHAR(50)'],
  ['contrato', 'VARCHAR(50)'],
  ['plataforma', 'VARCHAR(50)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, type] of COLUMNS) {
      await pool.query(`ALTER TABLE "USUARIOS_ROLES" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
      console.log(`  ✓ USUARIOS_ROLES."${col}" ${type}`);
    }
    console.log('✅ Columnas listas.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
