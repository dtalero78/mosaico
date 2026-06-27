/**
 * MOSAICO — columnas de alcance del evento en CALENDARIO.
 *
 * Un evento MOSAICO se define por Campaña → Curso → Salón → Módulo → Lección.
 * Módulo/Lección ya viven en nivel/step; se agregan campaign/curso/salon.
 * El valor 'Todos' (comodín) significa "todos los cursos/salones/módulos/lecciones
 * de esa campaña excepto IMPULSA" (la visibilidad real se resuelve en el panel del
 * estudiante, que se define después). El admin siempre ve todos los eventos.
 *
 * Uso: node scripts/add-calendario-mosaico-scope.js
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
    for (const col of ['campaign', 'curso', 'salon']) {
      await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "${col}" VARCHAR(255)`);
      console.log(`  ✓ CALENDARIO."${col}" VARCHAR(255)`);
    }
    console.log('✅ Columnas de alcance MOSAICO listas en CALENDARIO.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
