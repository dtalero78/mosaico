/**
 * Migración Ctrl Horas:
 *   - ALTER CALENDARIO agrega: timeout, notasadvisor, sesionCerrada, fechaCierreSesion
 *   - CREATE TABLE ADVISOR_EVENT_LOG (snapshots inmutables Canceled/Suspended)
 *   - APP_CONFIG seed: sesion_requiere_registro = 'true'
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.
 *
 * Semántica de los nuevos campos en CALENDARIO:
 *   - timeout            VARCHAR(5)   — hora militar HH:MM, lo escribe el advisor
 *   - notasadvisor       TEXT          — notas del advisor (distinto de observaciones=admin)
 *   - sesionCerrada      BOOLEAN       — true cuando el advisor hizo "Registrar Sesión"
 *   - fechaCierreSesion  TIMESTAMPTZ   — cuándo se cerró
 *
 * Semántica de ADVISOR_EVENT_LOG:
 *   - Solo guarda eventos en estado Canceled (cambio de advisor) o Suspended (cancel total).
 *   - Tabla inmutable (solo INSERTs, nunca UPDATEs).
 *   - Snapshot completo del evento al momento de la transición — sobrevive aunque el
 *     evento se borre físicamente de CALENDARIO.
 *
 * Reglas de transición (en code, no SQL):
 *   - updateEvent con cambio de advisor A→B → INSERT Canceled para A (max 2 por evento)
 *   - deleteEvent → INSERT Suspended para advisor actual (sin límite)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    console.log('▶ ALTER CALENDARIO (4 columnas nuevas)…');
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "timeout" VARCHAR(5)`);
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "notasadvisor" TEXT`);
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "sesionCerrada" BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "fechaCierreSesion" TIMESTAMPTZ`);

    console.log('▶ CREATE ADVISOR_EVENT_LOG…');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "ADVISOR_EVENT_LOG" (
        "_id"              VARCHAR(50) PRIMARY KEY,
        "advisorId"        VARCHAR(50) NOT NULL,
        "eventoId"         VARCHAR(50) NOT NULL,
        "estado"           VARCHAR(20) NOT NULL,
        "fechaEvento"      TIMESTAMPTZ NOT NULL,
        "horaInicio"       VARCHAR(5),
        "tipo"             VARCHAR(20),
        "nivel"            VARCHAR(20),
        "step"             VARCHAR(50),
        "tituloEvento"     TEXT,
        "horaFin"          VARCHAR(5),
        "observaciones"    TEXT,
        "canceladoPor"     VARCHAR(255) NOT NULL,
        "fechaTransicion"  TIMESTAMPTZ DEFAULT NOW(),
        "motivoTransicion" TEXT,
        "_createdDate"     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_advlog_advisor_fecha" ON "ADVISOR_EVENT_LOG" ("advisorId", "fechaEvento" DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_advlog_evento" ON "ADVISOR_EVENT_LOG" ("eventoId")`);

    console.log('▶ APP_CONFIG seed sesion_requiere_registro=true…');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "APP_CONFIG" (
        "key"          VARCHAR(100) PRIMARY KEY,
        "value"        TEXT NOT NULL,
        "color"        VARCHAR(20) DEFAULT '#ffffff',
        "updatedBy"    VARCHAR(255),
        "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO "APP_CONFIG" ("key", "value", "updatedBy")
      VALUES ('sesion_requiere_registro', 'true', 'migration')
      ON CONFLICT ("key") DO NOTHING
    `);

    const cols = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='CALENDARIO' AND column_name IN ('timeout','notasadvisor','sesionCerrada','fechaCierreSesion')
       ORDER BY column_name`
    );
    console.log('\n✅ Estado final CALENDARIO:');
    cols.rows.forEach(r => console.log(`   ${r.column_name}: ${r.data_type}`));

    const log = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='ADVISOR_EVENT_LOG' ORDER BY ordinal_position`
    );
    console.log('\n✅ ADVISOR_EVENT_LOG (' + log.rows.length + ' columnas):');
    log.rows.forEach(r => console.log(`   ${r.column_name}: ${r.data_type}`));

    const conf = await pool.query(
      `SELECT "key", "value" FROM "APP_CONFIG" WHERE "key"='sesion_requiere_registro'`
    );
    console.log('\n✅ APP_CONFIG:');
    conf.rows.forEach(r => console.log(`   ${r.key} = ${r.value}`));
  } catch (e) {
    console.error('❌ ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
