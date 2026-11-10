// Crea la tabla APROBACION_AUDIT: registro inmutable (solo INSERT) de cada cambio
// de PEOPLE.aprobacion (quién, cuándo, de qué estado a cuál, por qué vía y motivo).
// Idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Dry-run por defecto; --apply para crear.
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const SQL = [
  `CREATE TABLE IF NOT EXISTS "APROBACION_AUDIT" (
     "_id"              VARCHAR(64) PRIMARY KEY,
     "personId"         VARCHAR(64) NOT NULL,
     "contrato"         VARCHAR(64),
     "tipoUsuario"      VARCHAR(32),
     "nombre"           TEXT,
     "estadoAnterior"   VARCHAR(64),
     "estadoNuevo"      VARCHAR(64),
     "origen"           VARCHAR(64) NOT NULL,
     "motivo"           TEXT,
     "usuarioEmail"     VARCHAR(255),
     "usuarioNombre"    VARCHAR(255),
     "usuarioRol"       VARCHAR(64),
     "_createdDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS "APROBACION_AUDIT_contrato_idx" ON "APROBACION_AUDIT" ("contrato", "_createdDate" DESC)`,
  `CREATE INDEX IF NOT EXISTS "APROBACION_AUDIT_person_idx"   ON "APROBACION_AUDIT" ("personId", "_createdDate" DESC)`,
];

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const exists = (await c.query(`SELECT to_regclass('"APROBACION_AUDIT"') AS t`)).rows[0].t;
  console.log(`APROBACION_AUDIT existe: ${exists ? 'sí' : 'no'}`);
  if (!APPLY) {
    console.log('\nDRY-RUN — se ejecutaría:\n');
    SQL.forEach(s => console.log(s.replace(/\s+/g, ' ').trim() + ';'));
    console.log('\nCorre con --apply para crear.');
    await c.end();
    return;
  }
  await c.query('BEGIN');
  for (const s of SQL) await c.query(s);
  await c.query('COMMIT');
  console.log('✅ APROBACION_AUDIT lista (tabla + índices).');
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
