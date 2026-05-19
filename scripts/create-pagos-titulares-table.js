/**
 * One-time DDL: create PAGOS_TITULARES table (collection payments per titular).
 *
 * Stores one row per payment registered against a TITULAR. Fields are scoped
 * to a single cuota of the titular's plan. Validated by a RECAUDOS_JEFE (or
 * other role to be defined) before being considered final.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + indexes.
 *
 * NOTE: pagoTercero / idTercero are free-text fields (name + document of an
 * EXTERNAL person who paid on behalf of the titular). Not a FK to USUARIOS_ROLES.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "PAGOS_TITULARES" (
        "_id"                  TEXT PRIMARY KEY,
        "idPeople"             TEXT NOT NULL,
        "numeroId"             VARCHAR(50),
        "gestorRecaudo"        VARCHAR(255),
        "plataforma"           VARCHAR(100),
        "pagoTercero"          VARCHAR(255),
        "idTercero"            VARCHAR(50),
        "fechaPago"            DATE NOT NULL DEFAULT CURRENT_DATE,
        "fechaVencimiento"     DATE,
        "fechaValidacion"      DATE,
        "plan"                 NUMERIC(12,2),
        "vlrTotalProg"         NUMERIC(12,2),
        "numCuota"             INTEGER CHECK ("numCuota" >= 0),
        "valorCuota"           NUMERIC(12,2),
        "valorPagado"          NUMERIC(12,2),
        "saldo"                NUMERIC(12,2),
        "descuento"            NUMERIC(12,2) DEFAULT 0,
        "medioPago"            TEXT,
        "numeroReferencia"     VARCHAR(100),
        "numeroFactura"        VARCHAR(100),
        "documentosAdjuntos"   JSONB DEFAULT '[]'::jsonb,
        "validado"             BOOLEAN DEFAULT false,
        "createdBy"            VARCHAR(255),
        "validadoPor"          VARCHAR(255),
        "_createdDate"         TIMESTAMPTZ DEFAULT NOW(),
        "_updatedDate"         TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT "fk_pagos_people" FOREIGN KEY ("idPeople") REFERENCES "PEOPLE"("_id")
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_pagos_idPeople"  ON "PAGOS_TITULARES" ("idPeople")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_pagos_numeroId"  ON "PAGOS_TITULARES" ("numeroId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_pagos_fechaPago" ON "PAGOS_TITULARES" ("fechaPago")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_pagos_validado"  ON "PAGOS_TITULARES" ("validado")`);

    const cols = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' ORDER BY ordinal_position`
    );
    console.log(`OK — tabla creada con ${cols.rowCount} columnas:`);
    cols.rows.forEach(r => console.log(`  ${r.column_name.padEnd(22)} ${r.data_type}`));
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
