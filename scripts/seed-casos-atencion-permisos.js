/**
 * seed-casos-atencion-permisos.js
 *
 * Otorga (idempotente) los permisos de "Casos de Atención" a los roles que YA
 * tienen SERVICIO.NIVELACIONES.VER (mismo público del reporte de Servicio):
 *   - SERVICIO.CASOS_ATENCION.VER      (con NIVELACIONES.VER)
 *   - SERVICIO.CASOS_ATENCION.GESTION  (con NIVELACIONES.GESTION)
 *   - SERVICIO.CASOS_ATENCION.EXPORTAR (con NIVELACIONES.EXPORTAR)
 *
 * SUPER_ADMIN/ADMIN bypassean por código; el resto se puede ajustar luego en
 * /admin/permissions.
 *
 * Uso:  node scripts/seed-casos-atencion-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const PARES = [
  ['SERVICIO.NIVELACIONES.VER',      'SERVICIO.CASOS_ATENCION.VER'],
  ['SERVICIO.NIVELACIONES.GESTION',  'SERVICIO.CASOS_ATENCION.GESTION'],
  ['SERVICIO.NIVELACIONES.EXPORTAR', 'SERVICIO.CASOS_ATENCION.EXPORTAR'],
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  const roles = (await pool.query(`SELECT "rol","permisos" FROM "ROL_PERMISOS"`)).rows;
  let cambios = 0;
  for (const r of roles) {
    const perms = Array.isArray(r.permisos) ? r.permisos
      : (typeof r.permisos === 'string' ? JSON.parse(r.permisos || '[]') : (r.permisos || []));
    const set = new Set(perms);
    const nuevos = [];
    for (const [origen, destino] of PARES) {
      if (set.has(origen) && !set.has(destino)) { set.add(destino); nuevos.push(destino); }
    }
    if (nuevos.length) {
      cambios++;
      console.log(`  ${r.rol}: + ${nuevos.join(', ')}`);
      if (APPLY) {
        await pool.query(`UPDATE "ROL_PERMISOS" SET "permisos"=$2::jsonb, "fechaActualizacion"=NOW(), "_updatedDate"=NOW() WHERE "rol"=$1`,
          [r.rol, JSON.stringify(Array.from(set))]);
      }
    }
  }
  console.log(cambios ? `\n  ${cambios} rol(es) ${APPLY ? 'actualizados' : 'a actualizar'}.` : '\n  Nada que hacer (ya estaban).');
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
