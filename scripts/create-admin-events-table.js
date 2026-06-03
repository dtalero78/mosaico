// Migración idempotente: crea ADMIN_EVENTS y sus índices.
//
// Eventos administrativos del advisor (Training, Support, Observation, Meeting,
// Development) — NO académicos, NO visibles a estudiantes. Cuentan para horas
// del advisor cuando son REGISTRADOS dentro de la ventana +40 / +120 min.
//
// Modelo: 1 fila por (eventGroupId + advisorId). Si se crea un Meeting para 5
// advisors, se insertan 5 filas con el mismo eventGroupId. Esto permite queries
// por advisor con índice directo (sin JOINs ni JSONB containment).
//
//   node scripts/create-admin-events-table.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "ADMIN_EVENTS" (
        "_id"           VARCHAR(255) PRIMARY KEY,
        "eventGroupId"  VARCHAR(255) NOT NULL,
        "advisorId"     VARCHAR(255) NOT NULL,
        "tipo"          VARCHAR(30)  NOT NULL CHECK ("tipo" IN ('TRAINING','SUPPORT','OBSERVATION','MEETING','DEVELOPMENT')),
        "titulo"        VARCHAR(200),
        "descripcion"   TEXT,
        "fechaInicio"   TIMESTAMPTZ  NOT NULL,
        "horas"         INTEGER      NOT NULL CHECK ("horas" > 0 AND "horas" <= 12),
        "registrado"    BOOLEAN      DEFAULT false,
        "fechaRegistro" TIMESTAMPTZ,
        "timeout"       VARCHAR(5),
        "notas"         TEXT,
        "motivoCierre"  VARCHAR(30),
        "createdBy"     VARCHAR(255),
        "_createdDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "_updatedDate"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabla ADMIN_EVENTS lista (o ya existía).');

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_events_advisor_fecha ON "ADMIN_EVENTS"("advisorId", "fechaInicio" DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_events_group         ON "ADMIN_EVENTS"("eventGroupId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_events_registrado    ON "ADMIN_EVENTS"("registrado", "fechaInicio")`);
    console.log('✅ Índices listos.');

    const cnt = await pool.query(`SELECT COUNT(*)::int n FROM "ADMIN_EVENTS"`);
    console.log(`   Filas actuales: ${cnt.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
