/**
 * Migración: PAGOS_TITULARES.tipoCarteraHistory JSONB
 *
 * Auditoría inmutable de cambios de tipoCartera (Normal / Prejuridico /
 * Ultimo Pago / Penalidad). Se almacena en la fila cuota#0 del titular
 * (mismo "anchor row" que ya guarda tipoCartera).
 *
 * Estructura de cada entry:
 *   {
 *     fecha:              ISO,        // timestamp del cambio
 *     motivo:             string,     // obligatorio, capturado del modal
 *     estadoAnterior:     string,     // tipoCartera previo (puede ser null)
 *     estadoNuevo:        string,     // tipoCartera nuevo
 *     realizadoPor:       string,     // session.user.email
 *     realizadoPorNombre: string,     // session.user.name (display)
 *   }
 *
 * Default '[]'::jsonb. Idempotente (ADD COLUMN IF NOT EXISTS).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      ALTER TABLE "PAGOS_TITULARES"
      ADD COLUMN IF NOT EXISTS "tipoCarteraHistory" JSONB DEFAULT '[]'::jsonb
    `);
    const cols = await pool.query(
      `SELECT data_type, column_default
       FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' AND column_name='tipoCarteraHistory'`
    );
    if (cols.rowCount === 0) {
      console.log('⚠ columna no detectada');
      process.exitCode = 1;
    } else {
      const r = cols.rows[0];
      console.log(`OK — tipoCarteraHistory ${r.data_type} default=${r.column_default ?? 'NULL'}`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
