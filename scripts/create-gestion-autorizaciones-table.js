/**
 * Crea GESTION_AUTORIZACIONES: la autorización de Coordinación para que el GUÍA
 * gestione un proceso que ya se le venció (columna "Autoriza" de Académico ›
 * Procesos sin gestión).
 *
 * Una fila por proceso autorizado, identificada por (tipo, refId):
 *   SESION        → refId = CALENDARIO._id
 *   EVENTO_ADMIN  → refId = ADMIN_EVENTS._id
 *   REPORTE       → refId = "campaña|curso|salón|semanaInicio"
 *
 * Vive en tabla aparte y no como columna de cada tabla porque el informe semanal
 * en BORRADOR no tiene fila propia donde ponerla (REPORTE_ACADEMICO_CIERRE sólo
 * existe cuando ya se cerró), y así las tres clases comparten una sola regla.
 *
 * `activa=false` = desmarcada: la fila se conserva con quién y cuándo la quitó.
 * `usadaEn`/`usadaPor` = el guía cerró el proceso con esa autorización.
 *
 * Además agrega REPORTE_ACADEMICO_CIERRE."autorizadoPor": quién autorizó el cierre
 * de un informe fuera de plazo (el distintivo "con autorización").
 *
 * Idempotente. Uso: node scripts/create-gestion-autorizaciones-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "GESTION_AUTORIZACIONES" (
  "_id"                  TEXT PRIMARY KEY,
  "tipo"                 VARCHAR(20) NOT NULL CHECK ("tipo" IN ('SESION','EVENTO_ADMIN','REPORTE')),
  "refId"                TEXT NOT NULL,
  "guiaId"               TEXT,
  "activa"               BOOLEAN NOT NULL DEFAULT true,
  "autorizadoPor"        TEXT NOT NULL,
  "autorizadoPorNombre"  TEXT,
  "autorizadoEn"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revocadoPor"          TEXT,
  "revocadoEn"           TIMESTAMPTZ,
  "usadaPor"             TEXT,
  "usadaEn"              TIMESTAMPTZ,
  "_createdDate"         TIMESTAMPTZ DEFAULT NOW(),
  "_updatedDate"         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT "GESTION_AUTORIZACIONES_unico" UNIQUE ("tipo","refId")
);
CREATE INDEX IF NOT EXISTS "idx_gestion_autorizaciones_guia" ON "GESTION_AUTORIZACIONES" ("guiaId") WHERE "activa" = true;
ALTER TABLE "REPORTE_ACADEMICO_CIERRE" ADD COLUMN IF NOT EXISTS "autorizadoPor" TEXT;
`;

(async () => {
  const { rows: [pre] } = await pool.query(
    `SELECT to_regclass('"GESTION_AUTORIZACIONES"') IS NOT NULL AS tabla,
            EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'REPORTE_ACADEMICO_CIERRE' AND column_name = 'autorizadoPor') AS columna`
  );
  console.log(`  GESTION_AUTORIZACIONES: ${pre.tabla ? 'ya existe' : 'NO existe'}`);
  console.log(`  REPORTE_ACADEMICO_CIERRE."autorizadoPor": ${pre.columna ? 'ya existe' : 'NO existe'}`);

  if (pre.tabla && pre.columna) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "GESTION_AUTORIZACIONES"`);
    console.log(`\n✓ Nada que hacer (${n} autorización(es) registradas).\n`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('\n(ensayo) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply para aplicarlo.\n');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  console.log('\n✓ Tabla y columna creadas.\n');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
