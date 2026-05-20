/**
 * One-time DDL: agregar columna PAGOS_TITULARES.inscripcion
 *
 * Tipo NUMERIC(12,2) — consistente con plan/vlrTotalProg/valorCuota/
 * valorPagado/saldo/descuento. En FINANCIEROS pagoInscripcion es
 * VARCHAR(100) por legacy Wix, pero PAGOS_TITULARES usa numeric
 * para todos sus campos de plata.
 *
 * Almacena el monto pagado como inscripción inicial al crearse el
 * contrato (registro cuota #0 generado junto con FINANCIEROS).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      ALTER TABLE "PAGOS_TITULARES"
      ADD COLUMN IF NOT EXISTS "inscripcion" NUMERIC(12,2)
    `);

    const cols = await pool.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' AND column_name='inscripcion'`
    );

    if (cols.rowCount === 0) {
      console.log('⚠ columna no detectada — algo falló');
      process.exitCode = 1;
    } else {
      const r = cols.rows[0];
      console.log(`OK — ${r.column_name} ${r.data_type}(${r.numeric_precision},${r.numeric_scale}) agregada a PAGOS_TITULARES`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
