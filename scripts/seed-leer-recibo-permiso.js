#!/usr/bin/env node
/**
 * seed-leer-recibo-permiso.js — da PERSON.FINANCIERA.LEER_RECIBO (botón
 * "Leer comprobante" de Registrar Pago) a todo rol que ya puede registrar o
 * validar pagos. Idempotente, dry-run por defecto.
 * USO: node scripts/seed-leer-recibo-permiso.js [--apply]
 */
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });
const APPLY = process.argv.includes('--apply');
const PERM = 'PERSON.FINANCIERA.LEER_RECIBO';
const BASE = ['PERSON.FINANCIERA.PAGOS_REGISTRAR', 'PERSON.FINANCIERA.PAGOS_VALIDAR'];

(async () => {
  const u = new URL(process.env.DATABASE_URL); u.searchParams.delete('sslmode');
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(`SELECT "rol","permisos" FROM "ROL_PERMISOS" WHERE "activo" IS NOT FALSE`);
    for (const row of r.rows) {
      const p = Array.isArray(row.permisos) ? row.permisos : JSON.parse(row.permisos || '[]');
      if (!BASE.some(b => p.includes(b)) || p.includes(PERM)) continue;
      console.log(`${APPLY ? 'ASIGNA' : 'asignaría'} ${PERM} -> ${row.rol}`);
      if (APPLY) await c.query(`UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`, [row.rol, JSON.stringify([...p, PERM])]);
    }
  } finally { await c.end(); }
})();
