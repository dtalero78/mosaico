/**
 * Crea la tabla CURSOS_SUSPENSIONES — fechas de clase suspendidas por curso.
 *
 * Utilidad: registrar que un día-clase de un curso NO se dicta (guía enfermo,
 * corte de luz, etc.). El generador de eventos las descuenta EXACTAMENTE igual
 * que a los festivos de Chile: no agenda ese día y corre la sesión al final del
 * curso, conservando el número total de clases.
 *
 * Por qué una tabla y no borrar el evento: al editar/regenerar un curso los
 * eventos se borran y se recrean desde (inicioCurso, finalCurso, horario). Si la
 * suspensión no estuviera persistida, la fecha suspendida reaparecería. Con la
 * tabla, la regeneración es idempotente y respeta lo suspendido.
 *
 * NO se toca CURSOS_CAMPAIGN.finalCurso a propósito: es la ventana nominal con la
 * que se cuenta el nº de sesiones. Si se extendiera, cada regeneración generaría
 * una sesión de más (el curso crecería solo). El fin real del curso es la fecha
 * del último evento.
 *
 * Uso:
 *   node scripts/create-cursos-suspensiones-table.js           (dry-run)
 *   node scripts/create-cursos-suspensiones-table.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const DDL = `
CREATE TABLE IF NOT EXISTS "CURSOS_SUSPENSIONES" (
  "_id"             TEXT PRIMARY KEY,
  "cursoCampaignId" TEXT NOT NULL,
  "fecha"           DATE NOT NULL,
  "motivo"          TEXT NOT NULL,
  "realizadoPor"       TEXT,
  "realizadoPorNombre" TEXT,
  "_createdDate"    TIMESTAMPTZ DEFAULT NOW()
)`;

const IDX_UNIQ = `
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cursos_suspensiones_curso_fecha"
  ON "CURSOS_SUSPENSIONES" ("cursoCampaignId", "fecha")`;

const IDX_CURSO = `
CREATE INDEX IF NOT EXISTS "idx_cursos_suspensiones_curso"
  ON "CURSOS_SUSPENSIONES" ("cursoCampaignId")`;

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const exists = await pool.query(`SELECT to_regclass('public."CURSOS_SUSPENSIONES"') AS t`);
    const yaExiste = !!exists.rows[0].t;
    console.log(`Tabla CURSOS_SUSPENSIONES: ${yaExiste ? 'YA EXISTE' : 'no existe'}`);

    if (!APPLY) {
      console.log('\n--- DRY RUN (sin --apply no se escribe nada) ---');
      console.log(DDL.trim());
      console.log(IDX_UNIQ.trim());
      console.log(IDX_CURSO.trim());
      if (yaExiste) {
        const n = await pool.query(`SELECT COUNT(*)::int n FROM "CURSOS_SUSPENSIONES"`);
        console.log(`\nFilas actuales: ${n.rows[0].n}`);
      }
      return;
    }

    await pool.query(DDL);
    await pool.query(IDX_UNIQ);
    await pool.query(IDX_CURSO);
    const n = await pool.query(`SELECT COUNT(*)::int n FROM "CURSOS_SUSPENSIONES"`);
    console.log(`✅ Tabla + índices listos. Filas: ${n.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
