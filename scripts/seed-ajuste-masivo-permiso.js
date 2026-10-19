/**
 * Otorga `ACADEMICO.AJUSTE_MASIVO.APLICAR` (Académico › Mantenimiento › Ajuste
 * masivo) a los roles que ya hacen el Ajuste Lecciones individual — es la misma
 * acción aplicada a un salón entero (decisión del usuario).
 *
 * Criterio: todo rol que tenga `STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO`.
 * SUPER_ADMIN y ADMIN bypassean igual; se les agrega por coherencia de la matriz.
 *
 * Correr DESPUÉS del deploy: antes, el código desplegado no conoce el permiso.
 * Idempotente. Uso: node scripts/seed-ajuste-masivo-permiso.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const PERMISO = 'ACADEMICO.AJUSTE_MASIVO.APLICAR';
const REFERENCIA = 'STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol" FROM "ROL_PERMISOS"
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
