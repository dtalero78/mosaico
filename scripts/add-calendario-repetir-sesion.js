/**
 * MOSAICO — "Repetir Lección" (Solicitud de Sesiones).
 *
 * El guía, desde /sesion/[id], puede solicitar repetir una lección del módulo
 * actual del salón. Agrega a CALENDARIO:
 *   - repetirSesion        BOOLEAN DEFAULT false  → marca la solicitud
 *   - repetirLeccion       VARCHAR                → lección a repetir (asignada en el modal)
 *   - fechaRepetirSesion   TIMESTAMPTZ            → cuándo se marcó
 *   - repetirMarcadoPor    VARCHAR                → email del guía que la solicitó
 *   - autorizadoRepetir    BOOLEAN DEFAULT false  → autorizada en el reporte
 *   - fechaAutorizadoRepetir TIMESTAMPTZ
 *   - autorizadoRepetirPor VARCHAR
 *
 * Idempotente. Uso: node scripts/add-calendario-repetir-sesion.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ALTERS = [
  ['repetirSesion', 'BOOLEAN DEFAULT false'],
  ['repetirLeccion', 'VARCHAR(120)'],
  ['fechaRepetirSesion', 'TIMESTAMPTZ'],
  ['repetirMarcadoPor', 'VARCHAR(200)'],
  ['autorizadoRepetir', 'BOOLEAN DEFAULT false'],
  ['fechaAutorizadoRepetir', 'TIMESTAMPTZ'],
  ['autorizadoRepetirPor', 'VARCHAR(200)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, tipo] of ALTERS) {
      await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
      console.log(`  ✓ CALENDARIO."${col}" ${tipo}`);
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendario_repetir ON "CALENDARIO" ("repetirSesion") WHERE "repetirSesion" = true`);
    console.log('✅ Columnas de "Repetir Lección" agregadas a CALENDARIO.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
