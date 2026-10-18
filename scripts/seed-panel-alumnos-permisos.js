/**
 * Otorga los permisos del Panel del guía › "Mis alumnos por curso":
 *
 *   ACADEMICO.PANEL_ALUMNOS.VER        → a todo rol que entra al Panel Guía
 *                                         (tiene `ACADEMICO.ADVISOR.VER_ENLACE`),
 *                                         incluido GUIA: es su propio panel.
 *   ACADEMICO.PANEL_ALUMNOS.VER_TODOS  → a esos mismos roles MENOS GUIA: quien ya
 *                                         puede abrir el panel de otro guía puede
 *                                         ver también sus alumnos. Al guía no le
 *                                         serviría (sólo ve lo suyo).
 *
 * SUPER_ADMIN y ADMIN no hacen falta (bypassean todo permiso).
 * Correr DESPUÉS del deploy: con el código anterior el permiso no hace nada.
 *
 * Idempotente. Uso: node scripts/seed-panel-alumnos-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const REFERENCIA = 'ACADEMICO.ADVISOR.VER_ENLACE';
const VER = 'ACADEMICO.PANEL_ALUMNOS.VER';
const VER_TODOS = 'ACADEMICO.PANEL_ALUMNOS.VER_TODOS';

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(
    `SELECT "rol", "permisos" FROM "ROL_PERMISOS"
      WHERE "permisos" @> $1::jsonb AND "rol" NOT IN ('SUPER_ADMIN','ADMIN')
      ORDER BY "rol"`,
    [JSON.stringify([REFERENCIA])]
  );

  const plan = rows.map(r => {
    const tiene = Array.isArray(r.permisos) ? r.permisos : [];
    const agregar = [VER, ...(r.rol === 'GUIA' ? [] : [VER_TODOS])].filter(p => !tiene.includes(p));
    return { rol: r.rol, agregar };
  }).filter(p => p.agregar.length);

  if (!plan.length) {
    console.log('✓ Nada por hacer: los roles ya tienen los permisos del panel de alumnos.');
    await pool.end();
    return;
  }
  for (const p of plan) console.log(`  ${p.rol}: + ${p.agregar.join(', ')}`);

  if (!APPLY) {
    console.log('\n(dry-run — nada se escribió. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  for (const p of plan) {
    await pool.query(
      `UPDATE "ROL_PERMISOS"
          SET "permisos" = "permisos" || $2::jsonb,
              "_updatedDate" = NOW(), "fechaActualizacion" = NOW()
        WHERE "rol" = $1`,
      [p.rol, JSON.stringify(p.agregar)]
    );
    console.log(`  ✓ ${p.rol}`);
  }
  console.log(`\n✓ ${plan.length} rol(es) actualizados.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
