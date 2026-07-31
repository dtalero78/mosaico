/**
 * seed-reporte-academico-permiso.js
 *
 * Otorga ACADEMICO.REPORTE_ACADEMICO.VER a los roles que deben ver el Reporte
 * Académico: GUIA (ve solo sus cursos), COORDINADOR_ACADEMICO, ASISTENTE_ACADEMICO,
 * ACADEMICO_JEFE. SUPER_ADMIN/ADMIN ya lo tienen por bypass. Idempotente.
 *
 * Uso: node scripts/seed-reporte-academico-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const PERM = 'ACADEMICO.REPORTE_ACADEMICO.VER';
const ROLES = ['GUIA', 'COORDINADOR_ACADEMICO', 'ASISTENTE_ACADEMICO', 'ACADEMICO_JEFE'];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  const before = (await pool.query(
    `SELECT "rol", ("permisos" @> $1::jsonb) AS tiene FROM "ROL_PERMISOS" WHERE "rol" = ANY($2) ORDER BY "rol"`,
    [JSON.stringify([PERM]), ROLES]
  )).rows;
  console.table(before);
  if (APPLY) {
    const r = await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = "permisos" || $1::jsonb, "fechaActualizacion" = NOW()
        WHERE "rol" = ANY($2) AND NOT ("permisos" @> $1::jsonb)`,
      [JSON.stringify([PERM]), ROLES]
    );
    console.log(`\n  ✅ Roles actualizados: ${r.rowCount}`);
  } else {
    console.log('\n  (dry-run — corre con --apply)');
  }
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
