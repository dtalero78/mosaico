/**
 * Siembra ACADEMICO.SESION.ACTIVIDAD_IA — el botón "Actividad IA" de /sesion/[id]
 * (redactar la actividad del grupo y enviarla por WhatsApp a los apoderados).
 *
 * Se otorga a quien ya puede entrar al panel del evento
 * (ACADEMICO.SESION.IR_A_SESION): es una acción del propio evento y la hace
 * quien lo dicta o lo coordina.
 *
 * SUPER_ADMIN/ADMIN no lo necesitan (bypass en requirePermission y
 * PermissionGuard). Idempotente.
 *
 * Uso: node scripts/seed-actividad-ia-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.SESION.ACTIVIDAD_IA';
const BASE = 'ACADEMICO.SESION.IR_A_SESION';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`);
  const cambios = rows
    .map(r => ({ ...r, permisos: Array.isArray(r.permisos) ? r.permisos : [] }))
    .filter(r => r.permisos.includes(BASE) && !r.permisos.includes(PERMISO));

  if (!cambios.length) {
    console.log('✅ Nada que sembrar — los roles con acceso al evento ya tienen el permiso.');
    await pool.end();
    return;
  }

  console.log(`\nSe agregará ${PERMISO} a:`);
  console.table(cambios.map(c => ({ rol: c.rol, antes: c.permisos.length, despues: c.permisos.length + 1 })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "_id" = $2`,
      [JSON.stringify([...c.permisos, PERMISO]), c._id]
    );
    console.log(`✅ ${c.rol}: +${PERMISO}`);
  }
  console.log('\nListo. La caché de permisos del servidor tarda hasta 5 min en refrescarse.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
