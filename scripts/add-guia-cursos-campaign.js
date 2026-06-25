/**
 * MOSAICO — agrega la columna "guia" a CURSOS_CAMPAIGN.
 *
 * Cada curso de una campaña tiene un Guía asignado. En MOSAICO "guía" = advisor:
 * el dropdown se alimenta de la tabla ADVISORS (motor académico compartido) y se
 * guarda el ADVISORS."_id" en CURSOS_CAMPAIGN."guia". NO se renombra ADVISORS
 * (la usan ~29 archivos del motor) ni se duplica en una tabla GUIAS.
 *
 * Uso: node scripts/add-guia-cursos-campaign.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "guia" VARCHAR(255)`);
    console.log('  ✓ CURSOS_CAMPAIGN."guia" VARCHAR(255)');
    const total = await pool.query(`SELECT COUNT(*)::int c FROM "CURSOS_CAMPAIGN"`);
    console.log(`✅ Columna lista. Total CURSOS_CAMPAIGN: ${total.rows[0].c}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
