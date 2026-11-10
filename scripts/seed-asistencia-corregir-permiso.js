/**
 * Siembra ACADEMICO.ASISTENCIA.CORREGIR (marcar/corregir asistencia sin la ventana
 * del guía). Se otorga a ASISTENTE_ACADEMICO, que ya corregía asistencia desde la
 * ficha. Coordinación y Admin no lo necesitan (bypass). Idempotente.
 * Uso: node scripts/seed-asistencia-corregir-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.ASISTENCIA.CORREGIR';
const ROLES = ['ASISTENTE_ACADEMICO'];
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const { rows } = await pool.query(`SELECT "rol","permisos" FROM "ROL_PERMISOS" WHERE "rol" = ANY($1)`, [ROLES]);
  for (const r of rows) {
    const p = Array.isArray(r.permisos) ? r.permisos : [];
    if (p.includes(PERMISO)) { console.log(r.rol, 'ya lo tiene'); continue; }
    console.log(r.rol, APPLY ? '→ agregando' : '(ensayo) se agregaría');
    if (APPLY) await pool.query(`UPDATE "ROL_PERMISOS" SET "permisos" = $2::jsonb, "_updatedDate" = NOW() WHERE "rol" = $1`, [r.rol, JSON.stringify([...p, PERMISO])]);
  }
  await pool.end();
})();
