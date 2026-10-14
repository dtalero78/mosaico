/**
 * Siembra los permisos de Servicio › Gestión Justificación (y la pestaña
 * "Justificaciones" del Panel Guía): SERVICIO.JUSTIFICACION.VER / JUSTIFICAR /
 * EXPORTAR.
 *
 * Roles (decisión del usuario, 14-oct-2026): GUIA, SERVICIO y SERVICIO_CASOS.
 * Con el rol GUIA el servidor limita la lista y la acción a los cursos que dicta,
 * así que darle el permiso no le abre los datos de otros guías.
 *
 * SUPER_ADMIN/ADMIN no lo necesitan (bypass). Idempotente.
 *
 * Uso: node scripts/seed-justificacion-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const PERMISOS = [
  'SERVICIO.JUSTIFICACION.VER',
  'SERVICIO.JUSTIFICACION.JUSTIFICAR',
  'SERVICIO.JUSTIFICACION.EXPORTAR',
];
const ROLES = ['GUIA', 'SERVICIO', 'SERVICIO_CASOS'];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "_id","rol","permisos" FROM "ROL_PERMISOS" WHERE "rol" = ANY($1)`, [ROLES]
  );
  const faltan = ROLES.filter(r => !rows.some(x => x.rol === r));
  if (faltan.length) console.log(`⚠ Roles que no existen en ROL_PERMISOS: ${faltan.join(', ')}`);

  const cambios = rows
    .map(r => {
      const actuales = Array.isArray(r.permisos) ? r.permisos : [];
      return { ...r, actuales, nuevos: PERMISOS.filter(p => !actuales.includes(p)) };
    })
    .filter(r => r.nuevos.length);

  if (!cambios.length) {
    console.log('✅ Nada que sembrar — los roles ya tienen los permisos.');
    await pool.end();
    return;
  }
  console.table(cambios.map(c => ({ rol: c.rol, antes: c.actuales.length, agrega: c.nuevos.join(' · ') })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }
  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "_id" = $2`,
      [JSON.stringify([...c.actuales, ...c.nuevos]), c._id]
    );
    console.log(`✅ ${c.rol}: +${c.nuevos.length}`);
  }
  console.log('\nListo. La caché de permisos del servidor tarda hasta 5 min en refrescarse.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
