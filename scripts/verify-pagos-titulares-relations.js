/**
 * Verificación: PAGOS_TITULARES.idPeople → PEOPLE._id
 *               PAGOS_TITULARES.numeroId  → PEOPLE.numeroId
 *
 * Sólo lectura. No modifica datos.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1) FK formal en information_schema
    const fk = await pool.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name        AS local_column,
        ccu.table_name         AS ref_table,
        ccu.column_name        AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'PAGOS_TITULARES'
    `);
    console.log('\n=== Foreign Keys en PAGOS_TITULARES ===');
    if (fk.rowCount === 0) {
      console.log('  (ninguna)');
    } else {
      fk.rows.forEach(r => console.log(`  ${r.local_column}  →  ${r.ref_table}.${r.ref_column}   [${r.constraint_name}]`));
    }

    // 2) Tipos de columnas claves en ambas tablas
    const cols = await pool.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE (table_name = 'PAGOS_TITULARES' AND column_name IN ('idPeople','numeroId'))
         OR (table_name = 'PEOPLE'          AND column_name IN ('_id','numeroId'))
      ORDER BY table_name, column_name
    `);
    console.log('\n=== Tipos de columna ===');
    cols.rows.forEach(r => {
      const len = r.character_maximum_length ? `(${r.character_maximum_length})` : '';
      console.log(`  ${r.table_name.padEnd(18)} ${r.column_name.padEnd(12)} ${r.data_type}${len}`);
    });

    // 3) Conteo / integridad referencial: huérfanos (idPeople apunta a un _id que no existe)
    const orphans = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM "PAGOS_TITULARES" pt
      LEFT JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
      WHERE p."_id" IS NULL
    `);
    console.log(`\nPagos cuyo idPeople NO existe en PEOPLE._id: ${orphans.rows[0].n}`);

    // 4) Consistencia numeroId: PAGOS_TITULARES.numeroId vs PEOPLE.numeroId del mismo idPeople
    const mismatch = await pool.query(`
      SELECT pt."_id" AS pago_id, pt."idPeople", pt."numeroId" AS pago_numId, p."numeroId" AS people_numId
      FROM "PAGOS_TITULARES" pt
      JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
      WHERE pt."numeroId" IS NOT NULL
        AND pt."numeroId" IS DISTINCT FROM p."numeroId"
      LIMIT 5
    `);
    console.log(`\nPagos con numeroId distinto al del PEOPLE asociado: ${mismatch.rowCount}`);
    if (mismatch.rowCount > 0) {
      mismatch.rows.forEach(r => console.log(`  pago=${r.pago_id} idPeople=${r.idPeople} pago.numId=${r.pago_numId}  people.numId=${r.people_numId}`));
    }

    // 5) Total de pagos
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM "PAGOS_TITULARES"`);
    console.log(`\nTotal pagos registrados: ${total.rows[0].n}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
