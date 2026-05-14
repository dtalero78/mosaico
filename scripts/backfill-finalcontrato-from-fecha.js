/**
 * One-time backfill: derive PEOPLE.finalContrato from fechaContrato + 12 months
 * when finalContrato is NULL.
 *
 * Assumes the standard contract vigencia of 12 months. This is the last gap
 * in contract date coverage after the prior consolidations (inicioContrato,
 * fechaContrato, vigencia normalization).
 *
 * Idempotent: only updates rows with finalContrato IS NULL AND
 * fechaContrato IS NOT NULL. Rows missing both stay untouched.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const pre = await pool.query(`
      SELECT COUNT(*)::int AS rellenable
      FROM "PEOPLE"
      WHERE "finalContrato" IS NULL
        AND "fechaContrato" IS NOT NULL
    `);
    console.log('Filas rellenables (finalContrato NULL, fechaContrato disponible):', pre.rows[0].rellenable);

    if (pre.rows[0].rellenable === 0) {
      console.log('Nada por rellenar. Saliendo.');
      return;
    }

    const upd = await pool.query(`
      UPDATE "PEOPLE"
      SET "finalContrato" = ("fechaContrato" + INTERVAL '12 months')::date,
          "_updatedDate"  = NOW()
      WHERE "finalContrato" IS NULL
        AND "fechaContrato" IS NOT NULL
    `);
    console.log('Filas actualizadas:', upd.rowCount);

    const after = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "finalContrato" IS NOT NULL)::int AS con_final
      FROM "PEOPLE"
    `);
    console.log('Estado final:', after.rows[0]);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
