/**
 * MOSAICO — extiende CURSOS_CAMPAIGN con los campos del módulo Crea Campaña:
 *   inicioCampania (DATE, apertura de matrícula, nivel campaña),
 *   inicioCurso (DATE), duracionCurso (INT meses), finalCurso (DATE = inicio + meses),
 *   numeroUsuarios (INT cupos), usuInscritos (INT, default 0).
 *
 * También limpia el seed de prueba inicial (VERANO2026/OTONO2026) — las campañas
 * reales se crean desde el módulo Crea Campaña.
 *
 * Uso: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/extend-cursos-campaign-table.js
 * Idempotente: ADD COLUMN IF NOT EXISTS. La limpieza del seed solo corre con --reset-seed.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const COLUMNS = [
  ['inicioCampania', 'DATE'],
  ['inicioCurso', 'DATE'],
  ['duracionCurso', 'INTEGER'],
  ['finalCurso', 'DATE'],
  ['numeroUsuarios', 'INTEGER'],
  ['usuInscritos', 'INTEGER DEFAULT 0'],
];

(async () => {
  const resetSeed = process.argv.includes('--reset-seed');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, type] of COLUMNS) {
      await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
      console.log(`  ✓ CURSOS_CAMPAIGN."${col}" ${type}`);
    }
    // Asegurar default y backfill de usuInscritos
    await pool.query(`UPDATE "CURSOS_CAMPAIGN" SET "usuInscritos" = 0 WHERE "usuInscritos" IS NULL`);

    if (resetSeed) {
      const del = await pool.query(`DELETE FROM "CURSOS_CAMPAIGN" WHERE "campaign" IN ('VERANO2026','OTONO2026')`);
      console.log(`  ✓ Seed de prueba eliminado: ${del.rowCount} fila(s)`);
    }
    const total = await pool.query(`SELECT COUNT(*)::int c FROM "CURSOS_CAMPAIGN"`);
    console.log(`✅ Columnas listas. Total CURSOS_CAMPAIGN: ${total.rows[0].c}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
