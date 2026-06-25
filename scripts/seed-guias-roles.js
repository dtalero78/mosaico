/**
 * MOSAICO — (1) renombra el rol ADVISOR → GUIA en ROL_PERMISOS (conserva permisos),
 * y (2) crea las cuentas de login (USUARIOS_ROLES) de los guías a partir de la tabla
 * GUIAS (email + clave), con rol='GUIA'. Enlaza GUIAS.usuarioRolId.
 *
 * El valor del rol en código también es 'GUIA' (enum Role.ADVISOR = 'GUIA'), así que
 * un usuario con rol='GUIA' obtiene los permisos del antiguo ADVISOR y el panel-advisor.
 *
 * Uso:  node scripts/seed-guias-roles.js           (dry-run)
 *       node scripts/seed-guias-roles.js --apply    (escribe)
 * Idempotente: el rename solo corre si existe ADVISOR y no GUIA; el alta de usuarios
 * es upsert por email.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

(async () => {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    // (1) Rename del rol en ROL_PERMISOS
    const hasAdv = (await pool.query(`SELECT 1 FROM "ROL_PERMISOS" WHERE rol='ADVISOR' LIMIT 1`)).rows.length > 0;
    const hasGuia = (await pool.query(`SELECT 1 FROM "ROL_PERMISOS" WHERE rol='GUIA' LIMIT 1`)).rows.length > 0;
    console.log(`ROL_PERMISOS: ADVISOR=${hasAdv}  GUIA=${hasGuia}`);
    if (hasAdv && !hasGuia) {
      if (apply) {
        await pool.query(`UPDATE "ROL_PERMISOS" SET rol='GUIA', descripcion='Rol GUIA', "fechaActualizacion"=NOW() WHERE rol='ADVISOR'`);
        await pool.query(`UPDATE "USUARIOS_ROLES" SET rol='GUIA' WHERE rol='ADVISOR'`);
        console.log('  ✓ ROL_PERMISOS ADVISOR → GUIA (y USUARIOS_ROLES existentes)');
      } else {
        console.log('  (dry-run) Renombraría ADVISOR → GUIA en ROL_PERMISOS + USUARIOS_ROLES');
      }
    } else if (hasGuia) {
      console.log('  • Ya existe el rol GUIA; no se renombra.');
    } else {
      console.log('  • No existe ADVISOR ni GUIA en ROL_PERMISOS.');
    }

    // (2) Alta de cuentas de login para los guías (desde GUIAS)
    const guias = (await pool.query(
      `SELECT "_id","email","nombreCompleto","clave" FROM "GUIAS" WHERE "activo" IS NOT FALSE ORDER BY "nombreCompleto"`
    )).rows;
    console.log(`\nGUIAS activos: ${guias.length}`);

    let ins = 0, upd = 0, sinClave = 0;
    for (const g of guias) {
      const email = (g.email || '').trim();
      if (!email) continue;
      const tokens = (g.nombreCompleto || '').trim().split(/\s+/).filter(Boolean);
      const nombre = tokens[0] || g.nombreCompleto || '';
      const apellido = tokens.slice(1).join(' ');
      const password = (g.clave || '').trim();
      if (!password) sinClave++;

      if (!apply) {
        console.log(`   • ${email}  rol=GUIA  clave=${password ? '••••' : '(vacía)'}`);
        continue;
      }
      const r = await pool.query(
        `INSERT INTO "USUARIOS_ROLES" ("_id","email","nombre","apellido","password","rol","activo","origen","fechaCreacion","fechaActualizacion","_createdDate","_updatedDate")
         VALUES ($1,$2,$3,$4,$5,'GUIA',true,'ADMIN',NOW(),NOW(),NOW(),NOW())
         ON CONFLICT ("email") DO UPDATE SET
           "nombre"=EXCLUDED."nombre","apellido"=EXCLUDED."apellido","password"=EXCLUDED."password",
           "rol"='GUIA',"activo"=true,"fechaActualizacion"=NOW(),"_updatedDate"=NOW()
         RETURNING "_id", (xmax = 0) AS inserted`,
        [`usr_${randomUUID()}`, email, nombre, apellido, password]
      );
      const row = r.rows[0];
      if (row.inserted) ins++; else upd++;
      // Enlazar GUIAS.usuarioRolId
      await pool.query(`UPDATE "GUIAS" SET "usuarioRolId"=$1, "_updatedDate"=NOW() WHERE "_id"=$2`, [row._id, g._id]);
    }

    if (apply) {
      console.log(`\n✅ USUARIOS_ROLES guías → insertados: ${ins}, actualizados: ${upd}${sinClave ? `, sin clave: ${sinClave}` : ''}`);
      const tot = (await pool.query(`SELECT COUNT(*)::int c FROM "USUARIOS_ROLES" WHERE rol='GUIA'`)).rows[0].c;
      console.log(`   Total USUARIOS_ROLES rol=GUIA: ${tot}`);
    } else {
      console.log('\n(dry-run) No se escribió nada. Ejecuta con --apply.');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
