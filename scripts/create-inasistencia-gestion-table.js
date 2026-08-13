/**
 * Crea INASISTENCIA_GESTION: la gestión que hace Servicio sobre las inasistencias
 * de la semana (pestaña Asistencia de Casos de Atención).
 *
 * Una fila por BOOKING (= un estudiante que faltó a una sesión concreta), con dos
 * marcas independientes:
 *   - contactadoApoderado: la casilla que marca Servicio al hablar con la familia.
 *   - recordatorioEnviado: queda en true cuando se manda el WhatsApp desde la
 *     misma pantalla (guarda a qué número se envió, para poder auditarlo).
 *
 * `bookingId` es ÚNICO: la gestión pertenece a esa inasistencia puntual, no al
 * estudiante — si falta otro día es otra fila y se gestiona aparte.
 *
 * Uso: node scripts/create-inasistencia-gestion-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "INASISTENCIA_GESTION" (
  "_id"                    TEXT PRIMARY KEY,
  "bookingId"              TEXT NOT NULL UNIQUE,
  "academicaId"            TEXT,
  "numeroId"               TEXT,
  "contactadoApoderado"    BOOLEAN NOT NULL DEFAULT false,
  "contactadoPor"          TEXT,
  "contactadoEn"           TIMESTAMPTZ,
  "recordatorioEnviado"    BOOLEAN NOT NULL DEFAULT false,
  "recordatorioPor"        TEXT,
  "recordatorioEn"         TIMESTAMPTZ,
  "recordatorioTelefono"   TEXT,
  "_createdDate"           TIMESTAMPTZ DEFAULT NOW(),
  "_updatedDate"           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_inasistencia_gestion_academica" ON "INASISTENCIA_GESTION" ("academicaId");
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT to_regclass('"INASISTENCIA_GESTION"') IS NOT NULL AS existe`
  );
  if (pre[0].existe) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "INASISTENCIA_GESTION"`);
    console.log(`✓ La tabla ya existe (${n} fila(s)) — nada que hacer.`);
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('(dry-run) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply para crearla.');
    await pool.end();
    return;
  }

  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'INASISTENCIA_GESTION' ORDER BY ordinal_position`
  );
  console.log('✅ Tabla INASISTENCIA_GESTION creada:');
  console.table(rows);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
