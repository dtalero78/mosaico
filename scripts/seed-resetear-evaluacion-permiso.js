/**
 * Otorga ACADEMICO.PANEL_ALUMNOS.RESETEAR_EVALUACION a todo rol que ya tiene
 * ACADEMICO.PANEL_ALUMNOS.VER (GUIA incluido: el reseteo es sobre sus propios cursos).
 * SUPER_ADMIN/ADMIN bypassean. Idempotente. Uso: node scripts/seed-resetear-evaluacion-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const REF = 'ACADEMICO.PANEL_ALUMNOS.VER', NUEVO = 'ACADEMICO.PANEL_ALUMNOS.RESETEAR_EVALUACION';
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const { rows } = await pool.query(`SELECT "rol","permisos" FROM "ROL_PERMISOS" WHERE "permisos" @> $1::jsonb AND "rol" NOT IN ('SUPER_ADMIN','ADMIN') ORDER BY "rol"`, [JSON.stringify([REF])]);
  for (const r of rows) {
    const tiene = Array.isArray(r.permisos) ? r.permisos : [];
    if (tiene.includes(NUEVO)) { console.log(r.rol, '— ya lo tiene'); continue; }
    console.log(r.rol, APPLY ? '→ agregado' : '→ se agregaría');
    if (APPLY) await pool.query(`UPDATE "ROL_PERMISOS" SET "permisos" = "permisos" || $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`, [r.rol, JSON.stringify([NUEVO])]);
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
