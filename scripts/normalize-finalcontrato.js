/**
 * One-time normalization: round PEOPLE.finalContrato to midnight America/Bogota.
 *
 * Background: finalContrato is timestamptz and many rows were stored with a non-zero
 * time component (e.g. 19:00 -05). With the server in UTC, that time pushes the
 * date cast to the NEXT day, so expiration checks ('::date < CURRENT_DATE' and the
 * JS equivalent) missed the day the contract actually ended.
 *
 * After this script, every finalContrato is stored as `YYYY-MM-DD 00:00:00-05`, which
 * casts to the intended Bogotá date regardless of the server timezone.
 *
 * Idempotent: only rewrites rows whose value is not already midnight in Bogotá.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const preflight = await pool.query(`
      SELECT COUNT(*)::int AS pendientes
      FROM "PEOPLE"
      WHERE "finalContrato" IS NOT NULL
        AND ("finalContrato" AT TIME ZONE 'America/Bogota')
            <> date_trunc('day', "finalContrato" AT TIME ZONE 'America/Bogota')
    `);
    console.log('Filas con hora distinta de medianoche Bogotá:', preflight.rows[0].pendientes);

    if (preflight.rows[0].pendientes === 0) {
      console.log('Nada por normalizar. Saliendo.');
      return;
    }

    const result = await pool.query(`
      UPDATE "PEOPLE"
      SET "finalContrato" = (date_trunc('day', "finalContrato" AT TIME ZONE 'America/Bogota')
                             AT TIME ZONE 'America/Bogota'),
          "_updatedDate"  = NOW()
      WHERE "finalContrato" IS NOT NULL
        AND ("finalContrato" AT TIME ZONE 'America/Bogota')
            <> date_trunc('day', "finalContrato" AT TIME ZONE 'America/Bogota')
      RETURNING "_id"
    `);
    console.log('Filas normalizadas:', result.rowCount);

    const verify = await pool.query(`
      SELECT COUNT(*)::int AS pendientes
      FROM "PEOPLE"
      WHERE "finalContrato" IS NOT NULL
        AND ("finalContrato" AT TIME ZONE 'America/Bogota')
            <> date_trunc('day', "finalContrato" AT TIME ZONE 'America/Bogota')
    `);
    console.log('Filas pendientes tras normalizar (debería ser 0):', verify.rows[0].pendientes);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
