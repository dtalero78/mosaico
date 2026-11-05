/**
 * create-pagos-ajustes.js
 *
 * Crea PAGOS_AJUSTES: auditoría inmutable (sólo INSERT) de cada ajuste hecho
 * desde Recaudos › Gestión › Ajustes a una inscripción, pago o factura YA
 * VALIDADOS. Guarda antes/después y el "Saldo a la Fecha" antes y después.
 *
 * Idempotente. Dry-run por defecto:  node scripts/create-pagos-ajustes.js [--apply]
 */
require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

const SQL = `
CREATE TABLE IF NOT EXISTS "PAGOS_AJUSTES" (
  "_id"            VARCHAR(64) PRIMARY KEY,
  "pagoId"         VARCHAR(64) NOT NULL,
  "idPeople"       VARCHAR(64),
  "contrato"       VARCHAR(50),
  "numCuota"       INTEGER,
  "tipo"           VARCHAR(20) NOT NULL,
  "antes"          JSONB NOT NULL,
  "despues"        JSONB NOT NULL,
  "motivo"         TEXT NOT NULL,
  "saldoAntes"     VARCHAR(50),
  "saldoDespues"   VARCHAR(50),
  "usuarioEmail"   VARCHAR(255),
  "usuarioNombre"  VARCHAR(255),
  "usuarioRol"     VARCHAR(50),
  "_createdDate"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_pagos_ajustes_idpeople" ON "PAGOS_AJUSTES" ("idPeople");
CREATE INDEX IF NOT EXISTS "idx_pagos_ajustes_created"  ON "PAGOS_AJUSTES" ("_createdDate" DESC);
`;

(async () => {
  if (!process.argv.includes('--apply')) { console.log(SQL); console.log('(dry-run — usa --apply)'); return; }
  const u = new URL(process.env.DATABASE_URL); u.searchParams.delete('sslmode');
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(`SET lock_timeout = '5s'`);
    await c.query(SQL);
    const n = await c.query(`SELECT COUNT(*)::int AS n FROM "PAGOS_AJUSTES"`);
    console.log(`PAGOS_AJUSTES lista (${n.rows[0].n} registros).`);
  } finally { await c.end(); }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
