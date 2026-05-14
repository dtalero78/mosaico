/**
 * One-time normalization + DDL: convert PEOPLE.inicioContrato from timestamptz
 * to plain DATE.
 *
 * Background: inicioContrato is the legacy Wix-side "contract start date".
 * Like fechaContrato and finalContrato, it was stored as timestamptz with a
 * non-zero time component (Bogotá local), which causes ±1 day drift when
 * displayed in clients on different timezones.
 *
 * Idempotent in two steps:
 *   1. Round values to midnight America/Bogota (no-op for rows already at 00:00 -05)
 *   2. ALTER COLUMN to DATE (no-op if already DATE)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const TABLE = 'PEOPLE';
const COLUMN = 'inicioContrato';

async function getType(pool) {
  const r = await pool.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [TABLE, COLUMN]
  );
  return r.rows[0]?.data_type || null;
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const type = await getType(pool);
    console.log('Tipo actual:', type);

    if (type === 'date') {
      console.log('Ya es DATE. Nada por hacer.');
      return;
    }

    const pending = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${TABLE}"
       WHERE "${COLUMN}" IS NOT NULL
         AND ("${COLUMN}" AT TIME ZONE 'America/Bogota')
             <> date_trunc('day', "${COLUMN}" AT TIME ZONE 'America/Bogota')`
    );
    console.log('Filas a normalizar:', pending.rows[0].n);

    if (pending.rows[0].n > 0) {
      const upd = await pool.query(
        `UPDATE "${TABLE}"
         SET "${COLUMN}" = (date_trunc('day', "${COLUMN}" AT TIME ZONE 'America/Bogota')
                            AT TIME ZONE 'America/Bogota'),
             "_updatedDate" = NOW()
         WHERE "${COLUMN}" IS NOT NULL
           AND ("${COLUMN}" AT TIME ZONE 'America/Bogota')
               <> date_trunc('day', "${COLUMN}" AT TIME ZONE 'America/Bogota')`
      );
      console.log('Filas normalizadas:', upd.rowCount);
    }

    console.log('Convirtiendo a DATE…');
    await pool.query(
      `ALTER TABLE "${TABLE}"
       ALTER COLUMN "${COLUMN}" TYPE DATE
       USING ("${COLUMN}" AT TIME ZONE 'America/Bogota')::date`
    );
    console.log('Tipo nuevo:', await getType(pool));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
