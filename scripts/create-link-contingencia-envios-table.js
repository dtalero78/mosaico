/**
 * Crea LINK_CONTINGENCIA_ENVIOS: la bitácora de los links de sesión que se envían
 * por WhatsApp al apoderado desde Mantenimiento › Usuarios › Link de sesión.
 *
 * Una fila por ENVÍO (también los fallidos): sirve para auditar y para avisar si
 * el link de esa misma sesión ya se mandó antes. Append-only, como las demás
 * bitácoras.
 *
 * Uso: node scripts/create-link-contingencia-envios-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "LINK_CONTINGENCIA_ENVIOS" (
  "_id"              TEXT PRIMARY KEY,
  "academicaId"      TEXT NOT NULL,
  "numeroId"         TEXT,
  "eventoId"         TEXT NOT NULL,
  "fechaEvento"      TIMESTAMPTZ,
  "telefono"         TEXT,
  "ok"               BOOLEAN NOT NULL,
  "error"            TEXT,
  "enviadoPor"       TEXT,
  "enviadoPorNombre" TEXT,
  "_createdDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_link_contingencia_sesion" ON "LINK_CONTINGENCIA_ENVIOS" ("academicaId", "eventoId", "_createdDate" DESC);
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT to_regclass('"LINK_CONTINGENCIA_ENVIOS"') IS NOT NULL AS existe`
  );
  if (pre[0].existe) {
    console.log('✓ La tabla ya existe — nada que hacer.');
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
  console.log('✅ Tabla LINK_CONTINGENCIA_ENVIOS creada.');
  await pool.end();
})().catch(async (e) => {
  console.error('❌', e.message);
  await pool.end();
  process.exit(1);
});
