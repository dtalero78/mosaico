/**
 * Siembra los dos permisos de EDICIÓN nuevos del modal "Detalles de la Clase":
 *
 *   STUDENT.ACADEMIA.ANOTACION_ADVISOR.EDITAR
 *   STUDENT.ACADEMIA.COMENTARIOS_ESTUDIANTE.EDITAR
 *
 * Antes, quién podía ESCRIBIR en esas dos cajas estaba clavado en el código
 * (`userRole === SUPER_ADMIN || COORDINADOR_ACADEMICO`), así que cambiar los
 * permisos no lo movía. Ahora el permiso base deja VER la caja (solo lectura) y
 * estos dos dejan escribir.
 *
 * Se otorgan EXACTAMENTE a los roles que ya editaban — SUPER_ADMIN y
 * COORDINADOR_ACADEMICO — para que el cambio sea neutro: nadie gana acceso que
 * no tuviera, y nadie pierde el que tenía. A partir de ahí se administra desde
 * /admin/permissions.
 *
 * (ADMIN no se siembra: bypassea todos los permisos en el frontend, así que
 * seguirá editando de todos modos.)
 *
 * Idempotente. Uso: node scripts/seed-permisos-editar-comentarios.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const NUEVOS = [
  'STUDENT.ACADEMIA.ANOTACION_ADVISOR.EDITAR',
  'STUDENT.ACADEMIA.COMENTARIOS_ESTUDIANTE.EDITAR',
];
// Los que hoy pueden escribir según el código anterior.
const ROLES = ['SUPER_ADMIN', 'COORDINADOR_ACADEMICO'];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`);
  const cambios = [];
  for (const r of rows) {
    if (!ROLES.includes(r.rol)) continue;
    const permisos = Array.isArray(r.permisos) ? r.permisos : [];
    const add = NUEVOS.filter(p => !permisos.includes(p));
    if (add.length) cambios.push({ _id: r._id, rol: r.rol, antes: permisos.length, agrega: add, permisos: [...permisos, ...add] });
  }

  if (!cambios.length) {
    console.log('✅ Nada que sembrar — los roles que editan ya tienen los permisos de edición.');
    await pool.end();
    return;
  }

  console.log('\nSe agregarán los permisos de EDICIÓN a:');
  console.table(cambios.map(c => ({ rol: c.rol, antes: c.antes, agrega: c.agrega.length, despues: c.antes + c.agrega.length })));

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
    console.log(`✅ ${c.rol}: +${c.agrega.join(', ')}`);
  }
  console.log('\nListo. Recuerda que el panel cachea los permisos: hay que recargar o volver a entrar.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
