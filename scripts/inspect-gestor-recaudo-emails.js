/**
 * Sólo lectura. Diagnóstico detallado de gestorRecaudo en PEOPLE/PAGOS_TITULARES.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    for (const t of ['PEOPLE', 'PAGOS_TITULARES']) {
      console.log(`\n=== ${t} — distribución de gestorRecaudo ===`);
      const r = await pool.query(`
        SELECT "gestorRecaudo", COUNT(*)::int AS total
        FROM "${t}"
        WHERE "gestorRecaudo" IS NOT NULL
        GROUP BY "gestorRecaudo"
        ORDER BY total DESC
      `);
      for (const row of r.rows) {
        const isEmail = row.gestorRecaudo.includes('@');
        let resolveInfo = '';
        if (isEmail) {
          const u = await pool.query(`SELECT "_id", "nombre", "rol" FROM "USUARIOS_ROLES" WHERE LOWER("email") = LOWER($1)`, [row.gestorRecaudo]);
          resolveInfo = u.rowCount > 0 ? `→ _id=${u.rows[0]._id}` : '→ ⚠️ NO en USUARIOS_ROLES';
        } else {
          const u = await pool.query(`SELECT "email", "nombre", "rol" FROM "USUARIOS_ROLES" WHERE "_id" = $1`, [row.gestorRecaudo]);
          resolveInfo = u.rowCount > 0 ? `(${u.rows[0].nombre} / ${u.rows[0].rol})` : '⚠️ _id no en USUARIOS_ROLES';
        }
        console.log(`  ${row.total.toString().padStart(4)} x ${row.gestorRecaudo}  ${resolveInfo}`);
      }
    }

    // Verificación específica: PEOPLE titulares de Angela que asigné con email
    const angelaId = '0a2e7fa6-ee6c-401f-bb2d-ab23ce5fe1fa';
    const r2 = await pool.query(`
      SELECT COUNT(*)::int AS t FROM "PEOPLE" WHERE "gestorRecaudo" = $1
    `, [angelaId]);
    console.log(`\nPEOPLE con gestorRecaudo=${angelaId} (Angela _id): ${r2.rows[0].t}`);

    const r3 = await pool.query(`
      SELECT COUNT(*)::int AS t FROM "PEOPLE" WHERE "gestorRecaudo" = 'angelapluas9@gmail.com'
    `);
    console.log(`PEOPLE con gestorRecaudo=angelapluas9@gmail.com (email): ${r3.rows[0].t}`);
  } finally {
    await pool.end();
  }
})();
