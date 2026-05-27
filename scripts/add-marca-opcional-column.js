/**
 * Migración: PEOPLE.marcaOpcional VARCHAR(10) DEFAULT NULL
 *
 * Bandera manual del área de Recaudos para destacar titulares en la tabla
 * /dashboard/recaudos/asignacion (columna "Opcional"). Valores actuales
 * vigentes:
 *   - 'OPC' (badge naranja) — el área lo marca desde el panel Financiero del
 *     titular vía el botón "Opcional". Click adicional al botón limpia la
 *     marca (toggle entre 'OPC' y NULL).
 *   - NULL — sin marca.
 *
 * Usamos VARCHAR(10) en vez de BOOLEAN porque podría agregarse 'ANT' u otros
 * valores en el futuro (ANT estaba calculada en mayo 2026 pero se eliminó —
 * podría volver como marca manual).
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
      ALTER TABLE "PEOPLE"
      ADD COLUMN IF NOT EXISTS "marcaOpcional" VARCHAR(10) DEFAULT NULL
    `);
    const cols = await pool.query(
      `SELECT data_type, character_maximum_length, column_default
       FROM information_schema.columns
       WHERE table_name='PEOPLE' AND column_name='marcaOpcional'`
    );
    if (cols.rowCount === 0) {
      console.log('⚠ columna no detectada');
      process.exitCode = 1;
    } else {
      const r = cols.rows[0];
      console.log(`OK — marcaOpcional ${r.data_type}(${r.character_maximum_length}) default=${r.column_default ?? 'NULL'}`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
