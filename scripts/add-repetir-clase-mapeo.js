/**
 * MOSAICO — "Repetir Lección" camino B (mapeo sesión→lección + contador/histórico).
 *
 * CURSOS_CAMPAIGN:
 *   - repetClass     INTEGER DEFAULT 0  → contador de solicitudes de repetición del
 *     salón (nace en 0; +1 al solicitar, −1 al rechazar).
 *   - historicRepet  JSONB DEFAULT '[]' → autorizaciones: { fecha, autorizadoPor,
 *     comentario, advisor, modulo, leccion }.
 *
 * CALENDARIO (mapeo sesión→lección, camino B):
 *   - leccionOrden   INTEGER            → posición de la lección que cubre esta sesión
 *     en la secuencia expandida del curso (1..M).
 *   - sesionModulo   VARCHAR(120)       → módulo asignado a la sesión (denormalizado).
 *   - sesionLeccion  VARCHAR(120)       → lección asignada a la sesión (denormalizado).
 *
 * Idempotente. Uso: node scripts/add-repetir-clase-mapeo.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const CC = [
  ['repetClass', 'INTEGER DEFAULT 0'],
  ['historicRepet', `JSONB DEFAULT '[]'::jsonb`],
];
const CAL = [
  ['leccionOrden', 'INTEGER'],
  ['sesionModulo', 'VARCHAR(120)'],
  ['sesionLeccion', 'VARCHAR(120)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [c, t] of CC) { await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "${c}" ${t}`); console.log(`  ✓ CURSOS_CAMPAIGN."${c}"`); }
    await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "repetClass" = 0 WHERE "repetClass" IS NULL`);
    await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "historicRepet" = '[]'::jsonb WHERE "historicRepet" IS NULL`);
    for (const [c, t] of CAL) { await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "${c}" ${t}`); console.log(`  ✓ CALENDARIO."${c}"`); }
    console.log('✅ Columnas de Repetir Lección (camino B) agregadas.');
  } catch (e) {
    console.error('ERROR:', e.message); process.exit(1);
  } finally { await pool.end(); }
})();
