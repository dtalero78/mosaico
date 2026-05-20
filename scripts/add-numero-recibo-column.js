/**
 * One-time DDL: PAGOS_TITULARES.numeroRecibo VARCHAR(20)
 *
 * Almacena el consecutivo del recibo de pago en formato LGS-####
 * (asignado al generar el PDF del recibo). Idempotente.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      ALTER TABLE "PAGOS_TITULARES"
      ADD COLUMN IF NOT EXISTS "numeroRecibo" VARCHAR(20)
    `);
    const cols = await pool.query(
      `SELECT data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' AND column_name='numeroRecibo'`
    );
    if (cols.rowCount === 0) {
      console.log('⚠ columna no detectada');
      process.exitCode = 1;
    } else {
      const r = cols.rows[0];
      console.log(`OK — numeroRecibo ${r.data_type}(${r.character_maximum_length}) agregada a PAGOS_TITULARES`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
