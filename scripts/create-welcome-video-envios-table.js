/**
 * Crea WELCOME_VIDEO_ENVIOS: una fila por cada envío del video de bienvenida
 * (pestaña Servicio › Welcome Session › Video Welcome).
 *
 * Es una bitácora: sólo se inserta. Guarda a quién (alumno y número), si fue al
 * apoderado, quién lo envió, qué video (key de Spaces) y si el alumno se promovió
 * de WELCOME a su curso con ese envío. La pestaña muestra "Enviado" con el último.
 *
 * Idempotente. Uso: node scripts/create-welcome-video-envios-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "WELCOME_VIDEO_ENVIOS" (
  "_id"                TEXT PRIMARY KEY,
  "academicaId"        TEXT NOT NULL,
  "numeroId"           TEXT,
  "telefono"           TEXT NOT NULL,
  "usoApoderado"       BOOLEAN NOT NULL DEFAULT false,
  "videoKey"           TEXT,
  "enviadoPor"         TEXT NOT NULL,
  "enviadoPorNombre"   TEXT,
  "promovido"          BOOLEAN NOT NULL DEFAULT false,
  "promocionDetalle"   TEXT,
  "_createdDate"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_welcome_video_envios_alumno" ON "WELCOME_VIDEO_ENVIOS" ("academicaId", "_createdDate" DESC);
`;

(async () => {
  const { rows: [pre] } = await pool.query(`SELECT to_regclass('"WELCOME_VIDEO_ENVIOS"') IS NOT NULL AS existe`);
  if (pre.existe) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "WELCOME_VIDEO_ENVIOS"`);
    console.log(`✓ La tabla ya existe (${n} envío(s)) — nada que hacer.`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('(ensayo) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply para crearla.');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  console.log('✓ Tabla WELCOME_VIDEO_ENVIOS creada.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
