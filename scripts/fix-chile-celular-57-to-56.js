/**
 * Corrige celular: reemplaza '57' inicial por '56' (Chile correcto) para
 * 3 beneficiarios específicos identificados manualmente como números
 * chilenos con prefijo Colombia mal asignado.
 *
 * Casos: Cecilia Alvarez, Fernando Barraza, Natalia Castillo.
 *
 * Verifica antes de cada update: plataforma='Chile' + contrato='01-%' +
 * celular empieza con '57'. Si algún registro no cumple → skip.
 *
 * Dry-run por defecto. Aplicar con: node scripts/fix-chile-celular-57-to-56.js --apply
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const TARGETS = [
  { id: 'b6b7c381-8766-41bd-bc16-04ee0008e5fd', expectedCelular: '57999738907', label: 'Cecilia Alvarez' },
  { id: 'prs_1776467613638_lyf2plw5z',         expectedCelular: '57974951768', label: 'Fernando Barraza' },
  { id: 'prs_1777484335739_qog7zd5z5',         expectedCelular: '57984862154', label: 'Natalia Castillo' },
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

    let okCount = 0;
    for (const t of TARGETS) {
      // Buscar registro y validar contexto
      const found = await pool.query(
        `SELECT "_id", "primerNombre", "primerApellido", "plataforma",
                "contrato", "celular"
         FROM "PEOPLE"
         WHERE "_id" LIKE $1 || '%'
            OR "_id" = $1`,
        [t.id.slice(0, 16)] // fallback por si los _id completos no calzan
      );

      if (found.rowCount === 0) {
        console.log(`  SKIP — no encontrado: ${t.label} (${t.id})`);
        continue;
      }

      // Match exacto si hay varios resultados
      const row = found.rows.find(r => r._id === t.id) || found.rows[0];
      const cleaned = (row.celular || '').replace(/[^0-9]/g, '');

      // Verificaciones de seguridad
      if (row.plataforma !== 'Chile') {
        console.log(`  SKIP — plataforma ≠ Chile: ${t.label} (es ${row.plataforma})`);
        continue;
      }
      if (!String(row.contrato || '').startsWith('01-')) {
        console.log(`  SKIP — contrato no empieza con '01-': ${t.label} (${row.contrato})`);
        continue;
      }
      if (!cleaned.startsWith('57')) {
        console.log(`  SKIP — celular no empieza con '57': ${t.label} (${row.celular})`);
        continue;
      }

      // Transformación: '57' → '56'
      const newCelular = '56' + cleaned.slice(2);
      console.log(
        `  ${row._id.slice(0,20).padEnd(20)}  ${t.label.padEnd(20)}  ` +
        `${row.celular} → ${newCelular}`
      );

      if (APPLY) {
        await pool.query(
          `UPDATE "PEOPLE" SET "celular" = $2, "_updatedDate" = NOW() WHERE "_id" = $1`,
          [row._id, newCelular]
        );
        okCount++;
      }
    }

    if (APPLY) {
      console.log(`\nOK — ${okCount} registro(s) actualizado(s)`);
    } else {
      console.log(`\nDry-run completado. Para aplicar:`);
      console.log(`  node scripts/fix-chile-celular-57-to-56.js --apply`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
