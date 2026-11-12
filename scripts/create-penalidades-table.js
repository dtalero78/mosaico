/**
 * Crea la tabla PENALIDADES (plan de cierre a cuotas con penalidad del 30% del saldo) y
 * la columna PAGOS_TITULARES."penalidadPlanId" (marca los pagos que pertenecen a un plan).
 *
 * Idempotente. Ensayo por defecto; con --apply escribe. Usa lock_timeout para no encolar
 * producción detrás de otra sesión.
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?]sslmode=[a-z-]+/, ''), ssl: { rejectUnauthorized: false } });

(async () => {
  const t = await pool.query(`SELECT to_regclass('"PENALIDADES"') AS t`);
  const c = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='PAGOS_TITULARES' AND column_name='penalidadPlanId'`);
  console.log('PENALIDADES existe:', !!t.rows[0].t, '· PAGOS_TITULARES.penalidadPlanId existe:', c.rowCount > 0);
  if (!APPLY) { console.log('Ensayo. Usa --apply para escribir.'); return pool.end(); }
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query(`SET LOCAL lock_timeout = '5s'`);
    await cl.query(`CREATE TABLE IF NOT EXISTS "PENALIDADES" (
      "_id" VARCHAR(80) PRIMARY KEY,
      "idPeople" VARCHAR(80) NOT NULL,
      "contrato" VARCHAR(80),
      "numero" INTEGER NOT NULL,
      "estado" VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
      "saldoInicial" NUMERIC(14,2) NOT NULL,
      "porcentaje" NUMERIC(5,2) NOT NULL DEFAULT 30,
      "valorPenalidad" NUMERIC(14,2) NOT NULL,
      "condonado" NUMERIC(14,2),
      "numCuotas" INTEGER NOT NULL,
      "cuotas" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "estadoAnterior" VARCHAR(40),
      "nota" TEXT,
      "creadoPor" VARCHAR(255),
      "completadaEn" TIMESTAMPTZ,
      "canceladaPor" VARCHAR(255),
      "canceladaEn" TIMESTAMPTZ,
      "motivoCancelacion" TEXT,
      "_createdDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "_updatedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("idPeople", "numero")
    )`);
    await cl.query(`CREATE INDEX IF NOT EXISTS idx_penalidades_people ON "PENALIDADES" ("idPeople")`);
    await cl.query(`ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "penalidadPlanId" VARCHAR(80)`);
    await cl.query('COMMIT');
    console.log('Aplicado.');
  } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
