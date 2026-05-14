/**
 * One-time backfill: derive PEOPLE.inicioContrato from finalContrato - 12 months
 * when inicioContrato is NULL but finalContrato is populated.
 *
 * Why 12 months: standard contract length on the platform. After the prior
 * fechaContrato/inicioContrato consolidation, the only rows still missing
 * inicioContrato are records whose Wix migration didn't carry the start date.
 * Computing it from finalContrato is the best approximation available.
 *
 * Idempotent: only updates rows with inicioContrato IS NULL AND
 * finalContrato IS NOT NULL. Rows missing both stay untouched (they have no
 * contract data to derive from).
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
      WHERE "inicioContrato" IS NULL
        AND "finalContrato" IS NOT NULL
    `);
    console.log('Filas rellenables (inicioContrato NULL, finalContrato disponible):', pre.rows[0].rellenable);

    if (pre.rows[0].rellenable === 0) {
      console.log('Nada por rellenar. Saliendo.');
      return;
    }

    const upd = await pool.query(`
      UPDATE "PEOPLE"
      SET "inicioContrato" = "finalContrato" - INTERVAL '12 months',
          "_updatedDate"   = NOW()
      WHERE "inicioContrato" IS NULL
        AND "finalContrato" IS NOT NULL
    `);
    console.log('Filas actualizadas:', upd.rowCount);

    const after = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "inicioContrato" IS NOT NULL)::int AS con_inicio,
             COUNT(*) FILTER (WHERE "inicioContrato" IS NULL)::int AS sin_inicio
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
