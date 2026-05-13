/**
 * One-time DDL: convert PEOPLE.finalContrato from timestamptz to DATE.
 *
 * Why: with a timestamptz, callers can accidentally store a value with a non-zero
 * time component (e.g. 19:00 -05). When the server (UTC) casts that to ::date,
 * it lands on the NEXT day, which silently breaks expiration checks.
 *
 * Pre-requisite: run scripts/normalize-finalcontrato.js first to ensure every
 * existing value is at midnight America/Bogota. After this DDL, all reads/writes
 * are plain YYYY-MM-DD and no time component can leak in.
 *
 * Idempotent: detects current type and skips if already DATE.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const info = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'PEOPLE' AND column_name = 'finalContrato'`
    );
    const current = info.rows[0]?.data_type;
    console.log('Tipo actual de finalContrato:', current);

    if (current === 'date') {
      console.log('Ya es DATE. Nada por hacer.');
      return;
    }

    console.log('Convirtiendo a DATE (USING AT TIME ZONE America/Bogota)...');
    await pool.query(
      `ALTER TABLE "PEOPLE"
       ALTER COLUMN "finalContrato" TYPE DATE
       USING ("finalContrato" AT TIME ZONE 'America/Bogota')::date`
    );
    console.log('OK. Verificando…');

    const after = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'PEOPLE' AND column_name = 'finalContrato'`
    );
    console.log('Tipo nuevo:', after.rows[0]?.data_type);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
