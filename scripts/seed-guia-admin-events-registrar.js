/**
 * Da al rol GUIA el permiso de REGISTRAR su evento administrativo.
 *
 * Los eventos administrativos se crearon para que el guía cerrara los suyos desde
 * su panel —el modal de Time Out está hecho para él—, pero el permiso nunca se le
 * asignó: al pulsar "Registrar" recibía "Permiso requerido:
 * ACADEMICO.ADMIN_EVENTS.REGISTRAR" y sus horas quedaban sin contar.
 *
 * Sólo se da `REGISTRAR`. NO `GESTIONAR` (crear y eliminar eventos es del
 * coordinador) ni `VER_TODOS` (ver los de los demás guías). Y el endpoint ya
 * comprueba que el evento sea SUYO —`Este evento no te pertenece`—, así que el
 * permiso no le abre los de nadie más.
 *
 * Idempotente. Uso: node scripts/seed-guia-admin-events-registrar.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const PERMISO = 'ACADEMICO.ADMIN_EVENTS.REGISTRAR';
const ROLES = ['GUIA'];

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const { rows } = await pool.query(
    `SELECT "rol", ("permisos" @> $1::jsonb) AS tiene
       FROM "ROL_PERMISOS" WHERE "rol" = ANY($2::text[])`,
    [JSON.stringify([PERMISO]), ROLES]);

  console.table(rows.map(r => ({ rol: r.rol, [`tiene ${PERMISO}`]: r.tiene })));
  const faltan = rows.filter(r => !r.tiene).map(r => r.rol);
  if (!faltan.length) { console.log('\n  ✅ Ya lo tienen todos.\n'); await pool.end(); return; }
  if (!APPLY) { console.log(`\n  se daría a: ${faltan.join(', ')}\n  (dry-run: no se escribió nada)\n`); await pool.end(); return; }

  const r = await pool.query(
    `UPDATE "ROL_PERMISOS"
        SET "permisos" = "permisos" || $1::jsonb,
            "fechaActualizacion" = NOW(), "_updatedDate" = NOW()
      WHERE "rol" = ANY($2::text[]) AND NOT ("permisos" @> $1::jsonb)`,
    [JSON.stringify([PERMISO]), faltan]);
  console.log(`\n  roles actualizados: ${r.rowCount}`);

  console.table((await pool.query(
    `SELECT "rol", ("permisos" @> $1::jsonb) AS tiene FROM "ROL_PERMISOS" WHERE "rol" = ANY($2::text[])`,
    [JSON.stringify([PERMISO]), ROLES])).rows);
  console.log('\n  ⚠ El permiso se cachea 5 min en el servidor y por sesión en el navegador:');
  console.log('    el guía tiene que volver a entrar para que le aparezca.\n');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
