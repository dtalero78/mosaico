/**
 * Corrige los 93 PAGOS_TITULARES de Angela: reemplaza 'angelapluas9@gmail.com'
 * por su _id de USUARIOS_ROLES ('0a2e7fa6-ee6c-401f-bb2d-ab23ce5fe1fa').
 *
 * Modo: dry-run por defecto. Use --apply para escribir.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const ANGELA_EMAIL = 'angelapluas9@gmail.com';
const ANGELA_ID = '0a2e7fa6-ee6c-401f-bb2d-ab23ce5fe1fa';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // Confirmar que el _id existe en USUARIOS_ROLES
    const u = await pool.query(`SELECT "email", "nombre", "rol", "activo" FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [ANGELA_ID]);
    if (u.rowCount === 0) {
      console.error(`ERROR: _id ${ANGELA_ID} no existe en USUARIOS_ROLES`);
      process.exit(1);
    }
    console.log(`Destino: ${u.rows[0].nombre} (${u.rows[0].email}, ${u.rows[0].rol}, activo=${u.rows[0].activo})`);
    console.log(`Cambio: gestorRecaudo='${ANGELA_EMAIL}' → '${ANGELA_ID}'\n`);

    for (const t of ['PEOPLE', 'PAGOS_TITULARES']) {
      const r = await pool.query(`SELECT COUNT(*)::int AS t FROM "${t}" WHERE "gestorRecaudo" = $1`, [ANGELA_EMAIL]);
      console.log(`${t}: ${r.rows[0].t} filas con gestorRecaudo=email`);
      if (r.rows[0].t > 0 && APPLY) {
        const upd = await pool.query(
          `UPDATE "${t}" SET "gestorRecaudo" = $1, "_updatedDate" = NOW() WHERE "gestorRecaudo" = $2`,
          [ANGELA_ID, ANGELA_EMAIL]
        );
        console.log(`  → actualizadas: ${upd.rowCount}`);
      }
    }

    if (!APPLY) {
      console.log('\n⚠️  DRY-RUN — no se escribió nada. Ejecuta con --apply para aplicar.');
    } else {
      console.log('\n✅ Corrección aplicada.');
    }
  } finally {
    await pool.end();
  }
})();
