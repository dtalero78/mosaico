/**
 * MOSAICO — columnas del motor que el seed mínimo de mosaico-db no creó en NIVELES.
 *
 * NivelesRepository (findAll/findByCode/getContenido/...) referencia videoUrl, video,
 * contenido, materialUsuario, nombreNivel, nivel. Sin ellas, GET /api/postgres/niveles
 * lanza "column does not exist" → 500 → el modal de evento no carga módulos/lecciones.
 *
 * Uso: node scripts/add-niveles-engine-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ALTERS = [
  ['videoUrl', 'TEXT'],
  ['video', 'TEXT'],
  ['contenido', 'TEXT'],
  ['materialUsuario', 'JSONB'],
  ['nombreNivel', 'VARCHAR(255)'],
  ['nivel', 'VARCHAR(100)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, tipo] of ALTERS) {
      await pool.query(`ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
      console.log(`  ✓ NIVELES."${col}" ${tipo}`);
    }
    console.log('✅ Columnas del motor agregadas a NIVELES.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
