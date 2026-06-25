/**
 * MOSAICO — crea la tabla GUIAS (catálogo de guías) con los mismos campos que
 * ADVISORS del motor LGS. NO se renombra ADVISORS (la usa el motor académico
 * compartido); GUIAS es una tabla propia de MOSAICO. El módulo Crea Campaña la
 * usa como catálogo: CURSOS_CAMPAIGN."guia" referencia GUIAS."_id".
 *
 * En mosaico-db NO existe ADVISORS (el seed fue mínimo), por lo que GUIAS arranca
 * vacía; los guías se cargan después. Si ADVISORS existiera, se siembra copiándola.
 *
 * Uso: node scripts/create-guias-table.js
 * Idempotente: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// Mismas columnas que ADVISORS (ver src/repositories/advisor.repository.ts).
const COLUMNS = [
  ['_id', 'VARCHAR(255) PRIMARY KEY'],
  ['email', 'TEXT'],
  ['primerNombre', 'TEXT'],
  ['primerApellido', 'TEXT'],
  ['nombreCompleto', 'TEXT'],
  ['pais', 'TEXT'],
  ['zoom', 'TEXT'],
  ['telefono', 'TEXT'],
  ['activo', 'BOOLEAN DEFAULT true'],
  ['fotoAdvisor', 'TEXT'],
  ['domicilioadvisor', 'TEXT'],
  ['fechaNacimiento', 'DATE'],
  ['usuarioRolId', 'VARCHAR(255)'],
  ['_createdDate', 'TIMESTAMPTZ DEFAULT NOW()'],
  ['_updatedDate', 'TIMESTAMPTZ DEFAULT NOW()'],
  // Extras MOSAICO (provienen del CSV de guías): clave de acceso + cuenta/clave de Zoom.
  ['clave', 'TEXT'],
  ['cuentaZoom', 'TEXT'],
  ['claveZoom', 'TEXT'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    // Crear tabla con la PK y luego asegurar el resto de columnas (idempotente).
    await pool.query(`CREATE TABLE IF NOT EXISTS "GUIAS" ("_id" VARCHAR(255) PRIMARY KEY)`);
    for (const [col, type] of COLUMNS) {
      if (col === '_id') continue;
      await pool.query(`ALTER TABLE "GUIAS" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_guias_email" ON "GUIAS" (LOWER("email"))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_guias_activo" ON "GUIAS" ("activo")`);
    console.log('  ✓ Tabla GUIAS lista (15 columnas, mismos campos que ADVISORS)');

    // Sembrar desde ADVISORS si existe (en mosaico-db no existe → se omite).
    const adv = await pool.query(
      `SELECT to_regclass('public."ADVISORS"') IS NOT NULL AS exists`
    );
    if (adv.rows[0].exists) {
      const ins = await pool.query(
        `INSERT INTO "GUIAS" ("_id","email","primerNombre","primerApellido","nombreCompleto","pais","zoom","telefono","activo","fotoAdvisor","domicilioadvisor","fechaNacimiento","usuarioRolId","_createdDate","_updatedDate")
         SELECT a."_id",a."email",a."primerNombre",a."primerApellido",a."nombreCompleto",a."pais",a."zoom",a."telefono",a."activo",a."fotoAdvisor",a."domicilioadvisor",a."fechaNacimiento",a."usuarioRolId",a."_createdDate",a."_updatedDate"
         FROM "ADVISORS" a
         WHERE NOT EXISTS (SELECT 1 FROM "GUIAS" g WHERE g."_id" = a."_id")`
      );
      console.log(`  ✓ Sembradas ${ins.rowCount} fila(s) desde ADVISORS`);
    } else {
      console.log('  • ADVISORS no existe en esta BD → GUIAS arranca vacía (cargar guías después)');
    }

    const { rows } = await pool.query(`SELECT COUNT(*)::int c FROM "GUIAS"`);
    console.log(`✅ Total GUIAS: ${rows[0].c}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
