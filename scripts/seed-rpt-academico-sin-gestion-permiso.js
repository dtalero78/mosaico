/**
 * Da `ACADEMICO.RPT_ACADEMICO_SIN_GESTION.VER` a los roles que YA tienen
 * `ACADEMICO.SESIONES_SIN_GESTION.VER`.
 *
 * Son la misma tarea —el coordinador revisando qué quedó sin gestionar— así que
 * quien ya hace seguimiento de las sesiones debe ver también los informes. Se
 * siembra sobre ese permiso y no sobre una lista de roles escrita a mano para
 * que no haya que mantener dos listas en paralelo.
 *
 * SUPER_ADMIN y ADMIN no se tocan: pasan por bypass.
 *
 * Idempotente. Uso: node scripts/seed-rpt-academico-sin-gestion-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const ORIGEN = 'ACADEMICO.SESIONES_SIN_GESTION.VER';
const NUEVO = 'ACADEMICO.RPT_ACADEMICO_SIN_GESTION.VER';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" ORDER BY "rol"`
  );

  const objetivo = [];
  for (const r of rows) {
    const perms = Array.isArray(r.permisos) ? r.permisos : [];
    if (!perms.includes(ORIGEN)) continue;
    if (perms.includes(NUEVO)) { console.log(`  = ${r.rol} — ya lo tiene`); continue; }
    objetivo.push(r.rol);
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
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
