/**
 * Sólo lectura. Muestra el estado actual de un contrato específico.
 * Uso: node scripts/inspect-contrato.js <NUMERO_CONTRATO>
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const contrato = process.argv[2];
if (!contrato) {
  console.error('Uso: node scripts/inspect-contrato.js <NUMERO_CONTRATO>');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const rows = await pool.query(`
      SELECT "_id", "primerNombre", "primerApellido", "numeroId", "tipoUsuario",
             TO_CHAR("finalContrato", 'YYYY-MM-DD') AS "finalContrato",
             TO_CHAR("fechaContrato", 'YYYY-MM-DD') AS "fechaContrato",
             "vigencia", "estado", "aprobacion", "estadoInactivo",
             "extensionCount", TO_CHAR("_updatedDate", 'YYYY-MM-DD HH24:MI:SS') AS updated,
             "email"
      FROM "PEOPLE"
      WHERE "contrato" = $1
      ORDER BY "tipoUsuario" DESC, "primerApellido" NULLS LAST, "primerNombre" NULLS LAST
    `, [contrato]);

    console.log(`\n=== Contrato ${contrato} (${rows.rowCount} personas) ===\n`);
    for (const r of rows.rows) {
      const nombre = `${r.primerNombre || ''} ${r.primerApellido || ''}`.trim();
      console.log(`${r.tipoUsuario.padEnd(13)} | ${nombre.padEnd(35)} | ID ${(r.numeroId || '').padEnd(15)} | finalContrato=${r.finalContrato || '(null)'} | estado=${(r.estado || '(null)').padEnd(15)} | aprobacion=${(r.aprobacion || '(null)').padEnd(15)} | inactivo=${r.estadoInactivo === true ? 'true ' : 'false'} | ext=${r.extensionCount || 0} | updated=${r.updated}`);
      console.log(`             _id=${r._id} | email=${r.email || '(null)'}`);
    }

    // También verificar ACADEMICA por numeroId
    const numeroIds = rows.rows.map(r => r.numeroId).filter(Boolean);
    if (numeroIds.length > 0) {
      const academica = await pool.query(`
        SELECT "_id", "numeroId", "primerNombre", "primerApellido", "estadoInactivo",
               TO_CHAR("_updatedDate", 'YYYY-MM-DD HH24:MI:SS') AS updated
        FROM "ACADEMICA"
        WHERE "numeroId" = ANY($1::text[])
      `, [numeroIds]);
      console.log(`\n=== ACADEMICA (${academica.rowCount} registros) ===\n`);
      for (const a of academica.rows) {
        console.log(`  ${a.numeroId} | ${a.primerNombre || ''} ${a.primerApellido || ''} | inactivo=${a.estadoInactivo === true ? 'true ' : 'false'} | _id=${a._id} | updated=${a.updated}`);
      }
    }

    // USUARIOS_ROLES
    const emails = rows.rows.map(r => r.email).filter(Boolean);
    if (emails.length > 0) {
      const usuarios = await pool.query(`
        SELECT "email", "rol", "activo",
               TO_CHAR("_updatedDate", 'YYYY-MM-DD HH24:MI:SS') AS updated
        FROM "USUARIOS_ROLES"
        WHERE LOWER("email") = ANY($1::text[])
      `, [emails.map(e => e.toLowerCase())]);
      console.log(`\n=== USUARIOS_ROLES (${usuarios.rowCount} registros) ===\n`);
      for (const u of usuarios.rows) {
        console.log(`  ${u.email.padEnd(40)} | ${(u.rol || '').padEnd(15)} | activo=${u.activo === true ? 'true ' : 'false'} | updated=${u.updated}`);
      }
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
