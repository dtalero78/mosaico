/**
 * Inserta el rol "COMERCIAL_JEFE" en ROL_PERMISOS copiando EXACTAMENTE los
 * permisos del rol "COMERCIAL". Idempotente (no duplica si ya existe).
 * El admin ajusta los permisos luego en /admin/permissions. No se agrega al
 * enum Role del código — el RBAC carga permisos dinámicamente de ROL_PERMISOS,
 * así que un usuario con rol='COMERCIAL_JEFE' ya obtiene los permisos.
 * Uso: node scripts/duplicate-rol-comercial-jefe.js [--apply]
 */
const { randomUUID } = require('crypto');
const { Pool } = require('pg'); require('dotenv').config({ path: '.env.local' });
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async()=>{
  const src = (await pool.query(`SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol"='COMERCIAL' LIMIT 1`)).rows[0];
  if(!src){ console.error('No existe el rol COMERCIAL'); process.exit(1); }
  const exists = (await pool.query(`SELECT 1 FROM "ROL_PERMISOS" WHERE "rol"='COMERCIAL_JEFE'`)).rowCount>0;
  if(exists){ console.log('COMERCIAL_JEFE ya existe — no se duplica.'); await pool.end(); return; }
  if(!apply){ console.log('[dry-run] Se insertaría COMERCIAL_JEFE con', src.permisos.length, 'permisos. Usa --apply.'); await pool.end(); return; }
  await pool.query(
    `INSERT INTO "ROL_PERMISOS" ("_id","rol","descripcion","permisos","activo","fechaCreacion","fechaActualizacion","_createdDate","_updatedDate","origen")
     SELECT $1,'COMERCIAL_JEFE','Jefe Comercial (copiado de COMERCIAL)',"permisos",true,NOW(),NOW(),NOW(),NOW(),'ADMIN'
     FROM "ROL_PERMISOS" WHERE "rol"='COMERCIAL'`,
    [randomUUID()]
  );
  const r = (await pool.query(`SELECT "rol","activo", jsonb_array_length("permisos") n FROM "ROL_PERMISOS" WHERE "rol"='COMERCIAL_JEFE'`)).rows[0];
  console.log('OK — creado:', JSON.stringify(r));
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
