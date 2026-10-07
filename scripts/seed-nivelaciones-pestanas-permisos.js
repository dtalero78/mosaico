/**
 * Siembra los permisos nuevos de Servicio › Nivelaciones (oct-2026):
 *
 *  - SERVICIO.NIVELACIONES.AGRUPACIONES_VER y .PENDIENTES_VER → a todo rol que
 *    ya ve la página (SERVICIO.NIVELACIONES.VER) MENOS GUIA. Antes las dos
 *    pestañas venían con ese permiso; sin esta siembra, quien hoy las usa las
 *    perdería al desplegar. El GUIA queda sólo con Solicitudes e Histórico.
 *  - SERVICIO.NIVELACIONES.ADICIONAR → a quien ya tenía el botón
 *    (SERVICIO.NIVELACIONES.GESTION) y al rol GUIA.
 *
 * Correr ANTES del deploy no rompe nada: el código anterior no mira estos
 * permisos. SUPER_ADMIN/ADMIN no los necesitan (bypass). Idempotente.
 *
 * Uso: node scripts/seed-nivelaciones-pestanas-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const VER = 'SERVICIO.NIVELACIONES.VER';
const GESTION = 'SERVICIO.NIVELACIONES.GESTION';
const AGRUPACIONES = 'SERVICIO.NIVELACIONES.AGRUPACIONES_VER';
const PENDIENTES = 'SERVICIO.NIVELACIONES.PENDIENTES_VER';
const ADICIONAR = 'SERVICIO.NIVELACIONES.ADICIONAR';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`);
  const cambios = [];
  for (const r of rows) {
    const permisos = Array.isArray(r.permisos) ? r.permisos : [];
    const agregar = [];
    if (r.rol !== 'GUIA' && permisos.includes(VER)) {
      if (!permisos.includes(AGRUPACIONES)) agregar.push(AGRUPACIONES);
      if (!permisos.includes(PENDIENTES)) agregar.push(PENDIENTES);
    }
    if ((r.rol === 'GUIA' || permisos.includes(GESTION)) && !permisos.includes(ADICIONAR)) agregar.push(ADICIONAR);
    if (agregar.length) cambios.push({ _id: r._id, rol: r.rol, permisos, agregar });
  }

  if (!cambios.length) {
    console.log('✅ Nada que sembrar.');
    await pool.end();
    return;
  }

  console.table(cambios.map(c => ({ rol: c.rol, agrega: c.agregar.map(p => p.split('.').pop()).join(', ') })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "_id" = $2`,
      [JSON.stringify([...c.permisos, ...c.agregar]), c._id]
    );
    console.log(`✅ ${c.rol}: +${c.agregar.join(', +')}`);
  }
  console.log('\nListo. La caché de permisos del servidor tarda hasta 5 min en refrescarse.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
