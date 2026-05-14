/**
 * One-time fix: clamp PEOPLE.finalContrato year to 2026 when it is > 2027.
 *
 * Rationale: 116 rows had finalContrato in years 2028..2052, all clearly
 * data-entry mistakes from the Wix migration (no contract actually runs
 * 25+ years). Mes y día se conservan; sólo se reemplaza el año.
 *
 * Idempotent — only matches rows still with year > 2027.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const pre = await pool.query(`
      SELECT EXTRACT(YEAR FROM "finalContrato")::int AS anio, COUNT(*)::int AS n
      FROM "PEOPLE"
      WHERE "finalContrato" IS NOT NULL
        AND EXTRACT(YEAR FROM "finalContrato") > 2027
      GROUP BY anio
      ORDER BY anio
    `);
    console.log('Distribución de años > 2027:');
    console.table(pre.rows);

    if (pre.rows.length === 0) {
      console.log('Nada por corregir. Saliendo.');
      return;
    }

    const upd = await pool.query(`
      UPDATE "PEOPLE"
      SET "finalContrato" = MAKE_DATE(
            2026,
            EXTRACT(MONTH FROM "finalContrato")::int,
            EXTRACT(DAY FROM "finalContrato")::int
          ),
          "_updatedDate" = NOW()
      WHERE "finalContrato" IS NOT NULL
        AND EXTRACT(YEAR FROM "finalContrato") > 2027
    `);
    console.log('Filas actualizadas:', upd.rowCount);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
