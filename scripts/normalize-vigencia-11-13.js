/**
 * One-time normalization: replace PEOPLE.vigencia values of '11' and '13'
 * with the canonical '12'.
 *
 * Rationale: those off-by-one values were data-entry mistakes during Wix
 * imports (no contract actually had 11 or 13 months of vigencia — the
 * platform standard is 12). Distinct from `normalize-vigencia-without-extensions.js`
 * because '11' and '13' are within ±1 of the canonical value and aren't
 * gated by extensionCount.
 *
 * Idempotent.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const pre = await pool.query(`
      SELECT "vigencia", COUNT(*)::int AS n
      FROM "PEOPLE"
      WHERE "vigencia" IN ('11', '13')
      GROUP BY "vigencia"
    `);
    console.log('Filas con vigencia 11 o 13:');
    console.table(pre.rows);

    if (pre.rows.length === 0) {
      console.log('Nada por normalizar. Saliendo.');
      return;
    }

    const upd = await pool.query(`
      UPDATE "PEOPLE"
      SET "vigencia" = '12',
          "_updatedDate" = NOW()
      WHERE "vigencia" IN ('11', '13')
    `);
    console.log('Filas actualizadas:', upd.rowCount);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
