/**
 * Sólo lectura. Inspecciona FINANCIEROS para saber el tipo exacto de
 * pagoInscripcion (referencia para crear PAGOS_TITULARES.inscripcion).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale, character_maximum_length
      FROM information_schema.columns
      WHERE table_name='FINANCIEROS'
      ORDER BY ordinal_position
    `);
    console.log(`FINANCIEROS — ${cols.rowCount} columnas:`);
    cols.rows.forEach(r => {
      const t = r.data_type === 'numeric'
        ? `numeric(${r.numeric_precision},${r.numeric_scale})`
        : r.character_maximum_length
          ? `${r.data_type}(${r.character_maximum_length})`
          : r.data_type;
      console.log(`  ${r.column_name.padEnd(28)} ${t}`);
    });
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
