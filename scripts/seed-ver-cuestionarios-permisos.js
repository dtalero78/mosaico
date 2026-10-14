/**
 * Siembra los permisos de Académico › Guías › Ver Evaluación / Ver Entrenamiento:
 *   ACADEMICO.VER_EVALUACION.VER    → a quien ya tiene ACADEMICO.EVALUACIONES.VER
 *   ACADEMICO.VER_ENTRENAMIENTO.VER → a quien ya tiene ACADEMICO.ENTRENAMIENTOS.VER
 *
 * Mismo público que las pantallas de resultados: quien ve cómo le fue al grupo
 * puede ver el cuestionario que respondió. SUPER_ADMIN/ADMIN no lo necesitan
 * (bypass). Idempotente.
 *
 * Uso: node scripts/seed-ver-cuestionarios-permisos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const REGLAS = [
  { base: 'ACADEMICO.EVALUACIONES.VER', nuevo: 'ACADEMICO.VER_EVALUACION.VER' },
  { base: 'ACADEMICO.ENTRENAMIENTOS.VER', nuevo: 'ACADEMICO.VER_ENTRENAMIENTO.VER' },
];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows } = await pool.query(`SELECT "_id","rol","permisos" FROM "ROL_PERMISOS"`);
  const cambios = rows
    .map(r => {
      const actuales = Array.isArray(r.permisos) ? r.permisos : [];
      const nuevos = REGLAS.filter(x => actuales.includes(x.base) && !actuales.includes(x.nuevo)).map(x => x.nuevo);
      return { ...r, actuales, nuevos };
    })
    .filter(r => r.nuevos.length);

  if (!cambios.length) {
    console.log('✅ Nada que sembrar — los roles ya tienen los permisos.');
    await pool.end();
    return;
  }
  console.table(cambios.map(c => ({ rol: c.rol, antes: c.actuales.length, agrega: c.nuevos.join(' · ') })));

  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }
  for (const c of cambios) {
    await pool.query(
      `UPDATE "ROL_PERMISOS" SET "permisos" = $1::jsonb, "_updatedDate" = NOW(), "fechaActualizacion" = NOW() WHERE "_id" = $2`,
      [JSON.stringify([...c.actuales, ...c.nuevos]), c._id]
    );
    console.log(`✅ ${c.rol}: +${c.nuevos.length}`);
  }
  console.log('\nListo. La caché de permisos del servidor tarda hasta 5 min en refrescarse.');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
