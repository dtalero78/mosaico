/**
 * create-libro-produccion.js — esquema del Libro de Producción (Aprobación › Libro de Producción).
 *
 *  - PEOPLE (sólo en el TITULAR): escalera comercial del día de la matrícula
 *    (fullExecutive, jefeGrupo, gerente, gerenteDivision, salesManager), filial,
 *    origenMatricula, casillas manuales suscripcionPago / prixus y tipoPlanId.
 *  - VIGENCIAS_COMERCIALES: mes comercial, una por año+mes. inicio/fin son fecha-hora SIN
 *    zona (corte 09:00 hora local del país del contrato).
 *  - PLANES_TIPOS: catálogo de planes y tipos por país.
 *
 * Idempotente. Dry-run por defecto; --apply escribe.
 * Uso: node scripts/create-libro-produccion.js [--apply]
 */
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const APPLY = process.argv.includes('--apply');

const SQL = [
  `ALTER TABLE "PEOPLE"
     ADD COLUMN IF NOT EXISTS "fullExecutive"   VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "jefeGrupo"       VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "gerente"         VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "gerenteDivision" VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "salesManager"    VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "filial"          VARCHAR(150),
     ADD COLUMN IF NOT EXISTS "origenMatricula" VARCHAR(200),
     ADD COLUMN IF NOT EXISTS "suscripcionPago" BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS "prixus"          BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS "tipoPlanId"      VARCHAR(64)`,
  `CREATE TABLE IF NOT EXISTS "VIGENCIAS_COMERCIALES" (
     "_id"          VARCHAR(64) PRIMARY KEY,
     "anio"         INTEGER NOT NULL,
     "mes"          INTEGER NOT NULL CHECK ("mes" BETWEEN 1 AND 12),
     "inicio"       TIMESTAMP NOT NULL,
     "fin"          TIMESTAMP NOT NULL,
     "creadoPor"    VARCHAR(150),
     "_createdDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "_updatedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT "vigencias_anio_mes_uq" UNIQUE ("anio", "mes"),
     CONSTRAINT "vigencias_rango_ck" CHECK ("fin" > "inicio")
   )`,
  `CREATE TABLE IF NOT EXISTS "PLANES_TIPOS" (
     "_id"          VARCHAR(64) PRIMARY KEY,
     "pais"         VARCHAR(50) NOT NULL,
     "cuotas"       INTEGER NOT NULL CHECK ("cuotas" >= 1),
     "nombre"       VARCHAR(100) NOT NULL,
     "inscripcion"  NUMERIC(14,2),
     "valorCuota"   NUMERIC(14,2),
     "total"        NUMERIC(14,2),
     "descripcion"  TEXT,
     "activo"       BOOLEAN NOT NULL DEFAULT true,
     "creadoPor"    VARCHAR(150),
     "_createdDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "_updatedDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT "planes_tipos_uq" UNIQUE ("pais", "cuotas", "nombre")
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_people_titular_fechacreacion"
     ON "PEOPLE" ("fechaCreacion") WHERE "tipoUsuario" = 'TITULAR'`,
];

(async () => {
  if (!APPLY) { console.log('DRY-RUN — SQL con --apply:\n'); SQL.forEach((s) => console.log(s + ';\n')); return; }
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query(`SET lock_timeout = '5s'`);
    for (const s of SQL) { await c.query(s); console.log('✔', s.split('\n')[0]); }
  } finally { await c.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
