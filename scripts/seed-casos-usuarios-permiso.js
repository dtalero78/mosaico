/**
 * Siembra `ACADEMICO.CASOS_USUARIOS.VER` (Académico › Casos Usuarios).
 *
 * Se da a quien ya entra al panel de la sesión — los que abren los casos y los
 * que los gestionan: GUIA, COORDINADOR_ACADEMICO y ASISTENTE_ACADEMICO. El rol
 * GUIA verá SÓLO los casos que él mismo reportó (lo resuelve el servidor).
 * ADMIN/SUPER_ADMIN no se siembran: bypassean todo permiso.
 *
 * Idempotente. Uso: node scripts/seed-casos-usuarios-permiso.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.CASOS_USUARIOS.VER';
// Referencia: quien ya puede entrar a la sesión, que es donde nace el reporte.
const REFERENCIA = 'ACADEMICO.SESION.IR_A_SESION';

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "activo" = true ORDER BY "rol"`
  );

  const objetivo = rows.filter(r => {
    const p = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
    return p.includes(REFERENCIA) && !p.includes(PERMISO);
  });
  const yaLoTienen = rows.filter(r => {
    const p = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
    return p.includes(PERMISO);
  }).map(r => r.rol);

  console.log(`Permiso: ${PERMISO}`);
  console.log(`  ya lo tienen : ${yaLoTienen.join(', ') || '—'}`);
  console.log(`  se agregará a: ${objetivo.map(r => r.rol).join(', ') || '—'}`);

  if (!objetivo.length) { console.log('\n✅ Nada que hacer.'); await pool.end(); return; }
  if (!APPLY) { console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)'); await pool.end(); return; }

  for (const r of objetivo) {
    const p = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW()
        WHERE "rol" = $2`,
      [JSON.stringify([...p, PERMISO]), r.rol]
    );
  }

  const { rows: chk } = await pool.query(
    `SELECT "rol" FROM "ROL_PERMISOS" WHERE "activo" = true AND "permisos" @> $1::jsonb ORDER BY "rol"`,
    [JSON.stringify([PERMISO])]
  );
  console.log(`\n✅ Aplicado. Roles con el permiso: ${chk.map(r => r.rol).join(', ')}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
