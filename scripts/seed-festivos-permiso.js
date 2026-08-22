/**
 * Siembra `ACADEMICO.FESTIVOS.GESTION` a los roles que ya gestionan sesiones.
 *
 * Se da a quien ya tiene `ACADEMICO.SUSPENDER_SESIONES.GESTION`: declarar un
 * festivo y suspender una sesión son la misma clase de decisión (correr clases de
 * un día), sólo que una es global y la otra de un curso. Así nadie gana un acceso
 * que no tuviera. ADMIN y SUPER_ADMIN pasan por bypass, no hace falta sembrarlos.
 *
 * Idempotente. Uso: node scripts/seed-festivos-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.FESTIVOS.GESTION';
const BASE = 'ACADEMICO.SUSPENDER_SESIONES.GESTION';
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol","permisos" FROM "ROL_PERMISOS" WHERE "permisos" @> $1::jsonb ORDER BY "rol"`,
    [JSON.stringify([BASE])]
  );
  console.log(`\n  Roles con ${BASE}: ${rows.length}`);
  let n = 0;
  for (const r of rows) {
    const tiene = (r.permisos || []).includes(PERMISO);
    console.log(`    ${r.rol.padEnd(24)} ${tiene ? 'ya lo tiene' : '→ se le agrega'}`);
    if (tiene || !APPLY) continue;
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = "permisos" || $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`,
      [r.rol, JSON.stringify([PERMISO])]
    );
    n++;
  }
  console.log(APPLY ? `\n  ${n} rol(es) actualizados.\n` : '\n  Dry-run. Correr con --apply.\n');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
