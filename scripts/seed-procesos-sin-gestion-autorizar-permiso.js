/**
 * Da `ACADEMICO.PROCESOS_SIN_GESTION.AUTORIZAR` (la columna "Autoriza" de Procesos
 * sin gestión) al rol COORDINADOR_ACADEMICO — decisión del usuario (sep-2026):
 * autorizar al guía a gestionar lo vencido es una decisión de Coordinación.
 *
 * SUPER_ADMIN y ADMIN no se tocan: pasan por bypass. A los demás roles se les
 * marca en /admin/permissions si hace falta. Al rol GUIA no le sirve aunque se
 * le marque: el servidor no deja que un guía se autorice a sí mismo.
 *
 * Idempotente. Uso: node scripts/seed-procesos-sin-gestion-autorizar-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const NUEVO = 'ACADEMICO.PROCESOS_SIN_GESTION.AUTORIZAR';
const ROLES = ['COORDINADOR_ACADEMICO'];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "rol" = ANY($1::text[]) ORDER BY "rol"`,
    [ROLES]
  );
  const objetivo = [];
  for (const rol of ROLES) {
    const r = rows.find((x) => x.rol === rol);
    if (!r) { console.log(`  ? ${rol} — no existe en ROL_PERMISOS`); continue; }
    const perms = Array.isArray(r.permisos) ? r.permisos : [];
    if (perms.includes(NUEVO)) { console.log(`  = ${rol} — ya lo tiene`); continue; }
    objetivo.push(rol);
  }
  if (!objetivo.length) {
    console.log('\n✓ Nada que sembrar.\n');
    await pool.end();
    return;
  }
  console.log(`\n  Roles que recibirían ${NUEVO}:`);
  objetivo.forEach((r) => console.log(`   + ${r}`));
  if (!APPLY) {
    console.log('\n  Ensayo. Correr con --apply para guardarlo.\n');
    await pool.end();
    return;
  }
  for (const rol of objetivo) {
    await pool.query(
      `UPDATE "ROL_PERMISOS"
          SET "permisos" = "permisos" || $2::jsonb,
              "_updatedDate" = NOW(),
              "fechaActualizacion" = NOW()
        WHERE "rol" = $1`,
      [rol, JSON.stringify([NUEVO])]
    );
  }
  const { rows: after } = await pool.query(
    `SELECT "rol" FROM "ROL_PERMISOS" WHERE "permisos" @> $1::jsonb ORDER BY "rol"`,
    [JSON.stringify([NUEVO])]
  );
  console.log(`\n✓ ${objetivo.length} rol(es) actualizados. Ahora lo tienen: ${after.map((r) => r.rol).join(', ')}\n`);
  console.log('  Recuerda: la caché de permisos del middleware dura 5 min; se invalida con POST /api/admin/invalidate-permissions-cache {role}.\n');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
