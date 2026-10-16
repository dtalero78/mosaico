/**
 * Crea TALLER_RECORDATORIOS: la bitácora de los recordatorios de taller que se
 * envían por WhatsApp desde Servicio › Talleres.
 *
 * Una fila por ENVÍO (no por inscrito): si se reenvía, queda otra fila. La
 * pantalla muestra el último envío exitoso de cada agendamiento ("✓ Enviado…")
 * para que no se mande dos veces por error. Guarda a qué número se mandó y si
 * era el del apoderado, para poder auditarlo; append-only, como las demás
 * bitácoras.
 *
 * Uso: node scripts/create-taller-recordatorios-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "TALLER_RECORDATORIOS" (
  "_id"              TEXT PRIMARY KEY,
  "bookingId"        TEXT NOT NULL,
  "eventoId"         TEXT NOT NULL,
  "academicaId"      TEXT,
  "numeroId"         TEXT,
  "telefono"         TEXT,
  "esApoderado"      BOOLEAN NOT NULL DEFAULT false,
  "ok"               BOOLEAN NOT NULL,
  "error"            TEXT,
  "enviadoPor"       TEXT,
  "enviadoPorNombre" TEXT,
  "_createdDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_taller_recordatorios_booking" ON "TALLER_RECORDATORIOS" ("bookingId", "_createdDate" DESC);
CREATE INDEX IF NOT EXISTS "idx_taller_recordatorios_evento" ON "TALLER_RECORDATORIOS" ("eventoId");
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT to_regclass('"TALLER_RECORDATORIOS"') IS NOT NULL AS existe`
  );
  if (pre[0].existe) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "TALLER_RECORDATORIOS"`);
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

  await pool.query(`SET lock_timeout = '5s'`);
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'TALLER_RECORDATORIOS' ORDER BY ordinal_position`
  );
  console.log('✅ Tabla TALLER_RECORDATORIOS creada:');
  console.table(rows);
  await pool.end();
})().catch(async (e) => {
  console.error('❌', e.message);
  await pool.end();
  process.exit(1);
});
