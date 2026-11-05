#!/usr/bin/env node
/**
 * seed-mora-estado-cuenta-permisos.js — da a los roles de Recaudos
 *   - RECAUDOS.USUARIOS_MORA.VER        (informe Usuarios en mora)
 *   - PERSON.FINANCIERA.ESTADO_CUENTA   (botón Estado de Cuenta en la ficha)
 * Roles: RECAUDOS_JEFE y RECAUDOS_ASESOR. Idempotente, dry-run por defecto.
 * USO: node scripts/seed-mora-estado-cuenta-permisos.js [--apply]
 */
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const ROLES = ['RECAUDOS_JEFE', 'RECAUDOS_ASESOR'];
const PERMS = ['RECAUDOS.USUARIOS_MORA.VER', 'PERSON.FINANCIERA.ESTADO_CUENTA'];

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
