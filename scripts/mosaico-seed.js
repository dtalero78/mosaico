/**
 * Seed inicial MOSAICO:
 *   - ROL_PERMISOS: 10 roles desde ROLE_PERMISSIONS_MATRIX (src/config/roles.ts transpilado)
 *   - USUARIOS_ROLES: admin SUPER_ADMIN (bcrypt)
 *
 * Uso: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/mosaico-seed.js
 * Idempotente: ON CONFLICT (rol/email) DO UPDATE.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Parche de resolución del alias "@/types/permissions" → archivo transpilado
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@/types/permissions') {
    request = path.resolve(__dirname, '..', '.mosaico-tmp', 'permissions.js');
  }
  return origLoad.call(this, request, ...rest);
};

const { ROLE_PERMISSIONS_MATRIX } = require('../.mosaico-tmp/roles.js');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@mosaico.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tarelo5*';

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  try {
    // --- ROL_PERMISOS ---
    let roleCount = 0;
    for (const { role, permissions } of ROLE_PERMISSIONS_MATRIX) {
      await pool.query(
        `INSERT INTO "ROL_PERMISOS" ("_id","rol","descripcion","permisos","activo","fechaCreacion","fechaActualizacion","origen")
         VALUES ($1,$2,$3,$4::jsonb,true,NOW(),NOW(),'POSTGRES')
         ON CONFLICT ("rol") DO UPDATE SET "permisos"=EXCLUDED."permisos","activo"=true,"fechaActualizacion"=NOW(),"origen"='POSTGRES'`,
        [`rol_${role}`, role, `Rol ${role}`, JSON.stringify(permissions)]
      );
      roleCount++;
      console.log(`  ✓ ${role}: ${permissions.length} permisos`);
    }
    console.log(`✅ ROL_PERMISOS sembrado: ${roleCount} roles`);

    // --- Admin user ---
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO "USUARIOS_ROLES" ("_id","email","nombre","apellido","password","rol","activo","fechaCreacion","fechaActualizacion","origen")
       VALUES ($1,$2,'Admin','MOSAICO',$3,'SUPER_ADMIN',true,NOW(),NOW(),'POSTGRES')
       ON CONFLICT ("email") DO UPDATE SET "password"=EXCLUDED."password","rol"='SUPER_ADMIN',"activo"=true,"fechaActualizacion"=NOW()`,
      [`usr_${crypto.randomUUID()}`, ADMIN_EMAIL, hash]
    );
    console.log(`✅ Admin sembrado: ${ADMIN_EMAIL} (SUPER_ADMIN, bcrypt)`);

    const r = await pool.query('SELECT COUNT(*)::int n FROM "ROL_PERMISOS"');
    const u = await pool.query('SELECT COUNT(*)::int n FROM "USUARIOS_ROLES"');
    console.log(`   ROL_PERMISOS=${r.rows[0].n}  USUARIOS_ROLES=${u.rows[0].n}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
