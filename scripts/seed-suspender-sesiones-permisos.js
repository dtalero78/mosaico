/**
 * Otorga los permisos de "Suspende Sesión" a los roles que ya gestionan cursos.
 *
 * Criterio: quien ya puede crear/editar campañas y sus cursos (ACADEMICO.CAMPANA.CREAR)
 * es quien opera el calendario del curso, así que recibe VER + GESTION.
 * SUPER_ADMIN / ADMIN bypassean por rol, pero se les siembra igual por consistencia
 * del catálogo.
 *
 * Idempotente: no duplica permisos ya presentes.
 *
 * Uso:
 *   node scripts/seed-suspender-sesiones-permisos.js           (dry-run)
 *   node scripts/seed-suspender-sesiones-permisos.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const BASE = 'ACADEMICO.CAMPANA.CREAR';
const NUEVOS = ['ACADEMICO.SUSPENDER_SESIONES.VER', 'ACADEMICO.SUSPENDER_SESIONES.GESTION'];

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const roles = await pool.query(
      `SELECT "rol", "permisos" FROM "ROL_PERMISOS" WHERE "permisos"::jsonb ? $1 ORDER BY "rol"`,
      [BASE]
    );
    console.log(`Roles con ${BASE}: ${roles.rows.map(r => r.rol).join(', ') || '(ninguno)'}\n`);

    for (const r of roles.rows) {
      const actuales = Array.isArray(r.permisos) ? r.permisos : JSON.parse(r.permisos || '[]');
      const faltan = NUEVOS.filter(p => !actuales.includes(p));
      if (faltan.length === 0) { console.log(`  ${r.rol}: ya los tiene`); continue; }
      console.log(`  ${r.rol}: ${APPLY ? 'agregando' : 'agregaría'} ${faltan.join(', ')}`);
      if (APPLY) {
        await pool.query(
          `UPDATE "ROL_PERMISOS"
              SET "permisos" = ($2)::jsonb, "fechaActualizacion" = NOW(), "_updatedDate" = NOW()
            WHERE "rol" = $1`,
          [r.rol, JSON.stringify([...actuales, ...faltan])]
        );
      }
    }
    if (!APPLY) console.log('\n--- DRY RUN (sin --apply no se escribe nada) ---');
    else console.log('\n✅ Permisos sembrados. El caché de permisos tarda hasta 5 min en refrescar.');
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
