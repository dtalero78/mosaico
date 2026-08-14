/**
 * Siembra los dos permisos nuevos de la feature "Entrenamientos + Seguimiento":
 *
 *   1) ACADEMICO.ENTRENAMIENTOS.VER  → a los roles que YA tienen
 *      ACADEMICO.EVALUACIONES.VER. La pantalla de Entrenamientos es la misma
 *      que la de Evaluaciones sobre los módulos "Entrenamiento NN"; quien ya
 *      consultaba una debe ver la otra sin tener que pedirlo.
 *
 *   2) STUDENT.PANEL.SEGUIMIENTO     → al rol ESTUDIANTE, para que el alumno vea
 *      el botón "Seguimiento" en las cajas Entrenamientos y Evaluaciones de su
 *      panel (mismo patrón que STUDENT.PANEL.VER_VIDEO).
 *
 * SUPER_ADMIN y ADMIN no necesitan sembrarse (bypass en requirePermission y
 * PermissionGuard), pero se incluyen si ya tienen el permiso hermano.
 *
 * Idempotente: sólo añade el permiso a los roles que no lo tengan.
 *
 * Uso: node scripts/seed-entrenamientos-seguimiento-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const ENTRENAMIENTOS = 'ACADEMICO.ENTRENAMIENTOS.VER';
const SEGUIMIENTO = 'STUDENT.PANEL.SEGUIMIENTO';
const EVALUACIONES = 'ACADEMICO.EVALUACIONES.VER';

(async () => {
  const { rows } = await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`);

  const cambios = [];
  for (const r of rows) {
    const permisos = Array.isArray(r.permisos) ? r.permisos : [];
    const add = [];
    if (permisos.includes(EVALUACIONES) && !permisos.includes(ENTRENAMIENTOS)) add.push(ENTRENAMIENTOS);
    if (r.rol === 'ESTUDIANTE' && !permisos.includes(SEGUIMIENTO)) add.push(SEGUIMIENTO);
    if (add.length) cambios.push({ _id: r._id, rol: r.rol, antes: permisos.length, agrega: add.join(', '), despues: permisos.length + add.length, permisos: [...permisos, ...add] });
  }

  if (!cambios.length) {
    console.log('✅ Nada que sembrar — todos los roles ya tienen los permisos.');
    await pool.end();
    return;
  }

  console.log('\nRoles a actualizar:');
  console.table(cambios.map(({ rol, antes, agrega, despues }) => ({ rol, antes, agrega, despues })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "_id" = $2`,
      [JSON.stringify(c.permisos), c._id]
    );
    console.log(`✅ ${c.rol}: ${c.antes} → ${c.despues} permisos (+${c.agrega})`);
  }
  console.log('\nListo. La caché de permisos del servidor tarda hasta 5 min en refrescarse.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
