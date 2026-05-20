/**
 * Corrige celulares con prefijo '57' (Colombia) en registros con
 * plataforma='Chile' Y contrato que empieza por '01-' (prefijo Chile).
 * Doble verificación: SOLO toca registros donde plataforma + contrato
 * confirman que es Chile.
 *
 * Transformación: quita el '57' del inicio del celular (limpio de
 * no-dígitos). Si el resto comienza con '56' lo deja (eran doble prefijo
 * 57+56), sino lo deja sin prefijo de país (igual el resto del sistema
 * añade el prefijo correcto al usar).
 *
 * Dry-run por defecto. Para aplicar: node scripts/fix-chile-celular-57.js --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const rows = await pool.query(`
      SELECT "_id", "primerNombre", "primerApellido", "numeroId",
             "tipoUsuario", "celular", "contrato"
      FROM "PEOPLE"
      WHERE "plataforma" = 'Chile'
        AND "contrato" LIKE '01-%'
        AND REGEXP_REPLACE(COALESCE("celular", ''), '[^0-9]', '', 'g') LIKE '57%'
      ORDER BY "primerApellido" NULLS LAST, "primerNombre" NULLS LAST
    `);

    if (rows.rowCount === 0) {
      console.log('OK — sin candidatos (plataforma=Chile + contrato 01-% + celular 57...)');
      return;
    }

    console.log(`Encontrados ${rows.rowCount} candidatos:\n`);
    const updates = [];
    for (const r of rows.rows) {
      const original = r.celular;
      const cleaned  = String(original || '').replace(/[^0-9]/g, '');
      // Quita '57' del inicio
      const stripped = cleaned.startsWith('57') ? cleaned.slice(2) : cleaned;
      const name = `${r.primerNombre || ''} ${r.primerApellido || ''}`.trim() || '(sin nombre)';
      console.log(
        `  ${r._id.slice(0,16).padEnd(16)}  ${name.padEnd(35)}  ` +
        `contrato=${r.contrato.padEnd(22)}  ` +
        `celular: "${original}" → "${stripped}"`
      );
      updates.push({ id: r._id, newCelular: stripped });
    }

    if (!APPLY) {
      console.log(`\nDry-run (sin escribir). Para aplicar:`);
      console.log(`  node scripts/fix-chile-celular-57.js --apply`);
      return;
    }

    let updated = 0;
    for (const u of updates) {
      await pool.query(
        `UPDATE "PEOPLE"
         SET "celular" = $2, "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [u.id, u.newCelular]
      );
      updated++;
    }
    console.log(`\nOK — ${updated} registros actualizados`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
