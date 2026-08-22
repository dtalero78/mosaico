/**
 * `FESTIVOS_PERSONALIZADOS` — días sin clase que declara Académico.
 *
 * El calendario de Chile ya vive en el código (`src/lib/festivos-chile.ts`): los
 * fijos y la Semana Santa se calculan, y los movibles salen de un JSON curado. Eso
 * cubre los feriados legales, pero no los días que el colegio decide no dictar —
 * la semana de Fiestas Patrias, un puente, un cierre por evento.
 *
 * Esta tabla los AGREGA. Nunca anula: si la fecha ya es feriado del calendario, se
 * avisa y manda el del calendario — el efecto es el mismo (no hay clase) y así
 * nadie cree que borrando el personalizado se recupera el día.
 *
 * Es GLOBAL, a diferencia de `CURSOS_SUSPENSIONES`, que suspende un día de UN
 * curso concreto. Un feriado aplica a todos los cursos por igual.
 *
 * Idempotente. Uso: node scripts/create-festivos-personalizados-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "FESTIVOS_PERSONALIZADOS" (
  "_id"           VARCHAR(64) PRIMARY KEY,
  "fecha"         DATE        NOT NULL UNIQUE,
  "motivo"        TEXT        NOT NULL,
  "creadoPor"     VARCHAR(255),
  "creadoPorNombre" VARCHAR(255),
  "_createdDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_festivos_pers_fecha" ON "FESTIVOS_PERSONALIZADOS" ("fecha");
`;

(async () => {
  const { rows: [existe] } = await pool.query(
    `SELECT to_regclass('public."FESTIVOS_PERSONALIZADOS"') IS NOT NULL AS x`);
  console.log(`\n  FESTIVOS_PERSONALIZADOS: ${existe.x ? 'ya existe' : 'NO existe'}`);

  if (!APPLY) {
    console.log('\n  Dry-run. Correr con --apply para crearla.\n');
    await pool.end();
    return;
  }

  await pool.query(DDL);
  const { rows: [n] } = await pool.query(`SELECT COUNT(*)::int c FROM "FESTIVOS_PERSONALIZADOS"`);
  console.log(`  creada/verificada — ${n.c} festivo(s) cargado(s)\n`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
