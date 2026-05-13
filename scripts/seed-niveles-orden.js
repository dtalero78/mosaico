/**
 * One-time script to set NIVELES.orden for all rows of each nivel code.
 * NIVELES has one row per code+step, so we update ALL rows of each code
 * to the same orden value — this matches how /api/postgres/niveles groups
 * results by code.
 *
 * Pedagogical order:
 *   1  WELCOME    9  F1
 *   2  ESS       10  F2
 *   3  BN1       11  F3
 *   4  BN2       12  MASTER
 *   5  BN3       13  IELS
 *   6  P1        14  B2FIRST
 *   7  P2        15  TOEFL
 *   8  P3        16  DONE
 *
 * Idempotent: simple UPDATE by code; running multiple times yields same result.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const NIVELES_ORDEN = [
  ['WELCOME',  1],
  ['ESS',      2],
  ['BN1',      3],
  ['BN2',      4],
  ['BN3',      5],
  ['P1',       6],
  ['P2',       7],
  ['P3',       8],
  ['F1',       9],
  ['F2',      10],
  ['F3',      11],
  ['MASTER',  12],
  ['IELS',    13],
  ['B2FIRST', 14],
  ['TOEFL',   15],
  ['DONE',    16],
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const [code, orden] of NIVELES_ORDEN) {
      const r = await pool.query(
        'UPDATE "NIVELES" SET "orden" = $1, "_updatedDate" = NOW() WHERE "code" = $2 RETURNING "_id"',
        [orden, code]
      );
      console.log('Actualizado:', code.padEnd(8), 'orden=' + orden, '(' + r.rowCount + ' filas)');
    }
    console.log('---');
    const v = await pool.query(
      'SELECT DISTINCT "code", "orden" FROM "NIVELES" ORDER BY "orden" ASC NULLS LAST, "code" ASC'
    );
    console.log('Orden final:');
    v.rows.forEach(r => console.log('  ' + String(r.orden ?? '-').padStart(3) + '  ' + r.code));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
