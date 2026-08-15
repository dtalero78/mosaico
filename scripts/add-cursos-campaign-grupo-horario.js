/**
 * MOSAICO — columna `CURSOS_CAMPAIGN."grupoHorarioId"` (UUID, nullable).
 *
 * Agrupa hasta 3 cursos de la MISMA campaña que comparten guía y horario: el
 * guía dicta una sola sesión en un salón y atiende a los alumnos de los 3
 * cursos, pero la asistencia se marca por curso.
 *
 * El vínculo vive AQUÍ y no en los eventos a propósito: `generarEventosCurso`
 * borra y recrea los eventos del curso cada vez que se edita, así que cualquier
 * enlace guardado en CALENDARIO quedaría apuntando a filas borradas. El
 * `eventoCompartidoId` de cada evento se DERIVA de (grupoHorarioId + fecha),
 * de modo que se reconstruye solo en cada regeneración.
 *
 * Idempotente. Uso: node scripts/add-cursos-campaign-grupo-horario.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });

  const { rows: [col] } = await pool.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = 'CURSOS_CAMPAIGN' AND column_name = 'grupoHorarioId'`
  );
  const { rows: [idx] } = await pool.query(
    `SELECT 1 AS ok FROM pg_indexes
      WHERE tablename = 'CURSOS_CAMPAIGN' AND indexname = 'idx_cursos_campaign_grupo_horario'`
  );

  console.log(`Columna  "grupoHorarioId" : ${col ? `ya existe (${col.data_type})` : 'FALTA'}`);
  console.log(`Índice   idx_..._grupo_horario : ${idx ? 'ya existe' : 'FALTA'}`);

  if (col && idx) {
    console.log('\n✅ Nada que hacer.');
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('\n(dry-run — no se escribió nada. Reejecuta con --apply.)');
    await pool.end();
    return;
  }

  await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "grupoHorarioId" UUID`);
  // Parcial: sólo indexa las filas agrupadas, que son la minoría.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_cursos_campaign_grupo_horario
       ON "CURSOS_CAMPAIGN" ("grupoHorarioId") WHERE "grupoHorarioId" IS NOT NULL`
  );

  const { rows: [chk] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT("grupoHorarioId")::int AS agrupados
       FROM "CURSOS_CAMPAIGN"`
  );
  console.log(`\n✅ Aplicado. Cursos: ${chk.total} · agrupados: ${chk.agrupados} (ninguno hasta declararlos).`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
