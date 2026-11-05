#!/usr/bin/env node
/**
 * seed-migrar-cuentas-permiso.js — da RECAUDOS.ASIGNACION.MIGRAR (botón «Migrar Cuentas»)
 * a RECAUDOS_JEFE: mover toda la cartera de un gestor es una decisión de jefatura.
 * Idempotente, dry-run por defecto.
 * USO: node scripts/seed-migrar-cuentas-permiso.js [--apply]
 */
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const ROLES = ['RECAUDOS_JEFE'];
const PERMS = ['RECAUDOS.ASIGNACION.MIGRAR'];

(async () => {
  const u = new URL(process.env.DATABASE_URL); u.searchParams.delete('sslmode');
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    for (const rol of ROLES) {
      const r = await c.query(`SELECT "permisos" FROM "ROL_PERMISOS" WHERE "rol" = $1`, [rol]);
      if (!r.rows[0]) { console.log(`(sin rol ${rol})`); continue; }
      const p = Array.isArray(r.rows[0].permisos) ? r.rows[0].permisos : JSON.parse(r.rows[0].permisos || '[]');
      const faltan = PERMS.filter(x => !p.includes(x));
      if (!faltan.length) { console.log(`${rol}: ya los tiene`); continue; }
      console.log(`${APPLY ? 'ASIGNA' : 'asignaría'} ${faltan.join(', ')} -> ${rol}`);
      if (APPLY) await c.query(`UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`, [rol, JSON.stringify([...p, ...faltan])]);
    }
  } finally { await c.end(); }
})();
