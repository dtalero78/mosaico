// Migración idempotente: ACADEMICA_BOOKING_EVALUATIONS + seed APP_CONFIG
// para el feature flag de Performance Evaluation.
//
// Estructura:
//   - Tabla nueva con CHECK 1-5 en cada rating, UNIQUE bookingId, índices
//     para queries del dashboard (advisor+fecha, student, evento, promedio).
//   - APP_CONFIG seed:
//       performance_eval_mode       = 'off'   (default seguro)
//       performance_eval_beta_users = '[]'    (lista vacía de emails)
//
// Solo crea / inserta lo que falte. Re-ejecutable.
//   node scripts/create-evaluations-table.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1) Tabla
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "ACADEMICA_BOOKING_EVALUATIONS" (
        "_id"                  VARCHAR(255) PRIMARY KEY,
        "bookingId"            VARCHAR(255) NOT NULL UNIQUE,
        "studentId"            VARCHAR(255) NOT NULL,
        "advisorId"            VARCHAR(255),
        "eventoId"             VARCHAR(255),
        "tipo"                 VARCHAR(20),
        "subtipo"              VARCHAR(50),
        "nivel"                VARCHAR(20),
        "step"                 VARCHAR(50),
        "plataforma"           VARCHAR(50),
        "fechaEvento"          TIMESTAMPTZ,
        "puntualidad"          INT  NOT NULL CHECK ("puntualidad"          BETWEEN 1 AND 5),
        "claridad"             INT  NOT NULL CHECK ("claridad"             BETWEEN 1 AND 5),
        "actividades"          INT  NOT NULL CHECK ("actividades"          BETWEEN 1 AND 5),
        "ambiente"             INT  NOT NULL CHECK ("ambiente"             BETWEEN 1 AND 5),
        "promedio"             NUMERIC(3,2) NOT NULL,
        "comentario"           TEXT,
        "aiCategorias"         JSONB,
        "aiSentimiento"        VARCHAR(20),
        "aiAnalizadoEn"        TIMESTAMPTZ,
        "ipAddress"            VARCHAR(50),
        "userAgent"            TEXT,
        "_createdDate"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_advisor_fecha ON "ACADEMICA_BOOKING_EVALUATIONS"("advisorId", "fechaEvento" DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_student       ON "ACADEMICA_BOOKING_EVALUATIONS"("studentId", "_createdDate" DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_evento        ON "ACADEMICA_BOOKING_EVALUATIONS"("eventoId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_fecha_evento  ON "ACADEMICA_BOOKING_EVALUATIONS"("fechaEvento")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_promedio      ON "ACADEMICA_BOOKING_EVALUATIONS"("promedio")`);
    console.log('✅ Tabla ACADEMICA_BOOKING_EVALUATIONS lista (o ya existía).');

    // 2) APP_CONFIG seeds
    await pool.query(`
      INSERT INTO "APP_CONFIG"("key", "value")
      VALUES ('performance_eval_mode', 'off')
      ON CONFLICT ("key") DO NOTHING`);
    await pool.query(`
      INSERT INTO "APP_CONFIG"("key", "value")
      VALUES ('performance_eval_beta_users', '[]')
      ON CONFLICT ("key") DO NOTHING`);
    console.log('✅ APP_CONFIG seeds (performance_eval_mode=off, beta_users=[]).');

    // 3) Verificación
    const cnt = await pool.query(`SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKING_EVALUATIONS"`);
    const mode = await pool.query(`SELECT "value" FROM "APP_CONFIG" WHERE "key"='performance_eval_mode'`);
    console.log(`   Evaluaciones existentes: ${cnt.rows[0].n}`);
    console.log(`   performance_eval_mode actual: ${mode.rows[0]?.value ?? '(no leído)'}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
