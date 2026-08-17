/**
 * Otorga `ACADEMICO.HORARIOS.GESTION` (Académico › Horarios) a los roles que ya
 * gestionan campañas — es el mismo trabajo: quien define los cursos de una
 * campaña es quien necesita el catálogo de horarios.
 *
 * Criterio: todo rol que tenga `ACADEMICO.CAMPANA.CREAR`.
 * SUPER_ADMIN y ADMIN no hacen falta (bypassean todo permiso).
 *
 * Idempotente. Uso: node scripts/seed-horarios-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.HORARIOS.GESTION';
const REFERENCIA = 'ACADEMICO.CAMPANA.CREAR';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS"
      WHERE "permisos" @> $1::jsonb AND NOT ("permisos" @> $2::jsonb)`,
    [JSON.stringify([REFERENCIA]), JSON.stringify([PERMISO])]
  );

  if (!rows.length) {
    console.log(`✓ Nada por hacer: todos los roles con ${REFERENCIA} ya tienen ${PERMISO}.`);
    await pool.end();
    return;
  }
  console.log(`Roles a los que se les agregará ${PERMISO}: ${rows.map(r => r.rol).join(', ')}`);

  if (!APPLY) {
    console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  for (const r of rows) {
    await pool.query(
      `UPDATE "ROL_PERMISOS"
          SET "permisos" = "permisos" || $2::jsonb,
              "_updatedDate" = NOW(), "fechaActualizacion" = NOW()
        WHERE "rol" = $1`,
      [r.rol, JSON.stringify([PERMISO])]
    );
    console.log(`  ✓ ${r.rol}`);
  }
  console.log(`\n✓ ${rows.length} rol(es) actualizados.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
