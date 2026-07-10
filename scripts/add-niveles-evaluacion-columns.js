/**
 * MOSAICO — Fase 3 (evaluación manual vs IA por lección).
 *
 * Agrega a NIVELES:
 *   - "evaluacionModo"  VARCHAR(10) DEFAULT 'IA'   → 'IA' | 'MANUAL' por lección.
 *   - "preguntasManual" JSONB       DEFAULT '[]'   → preguntas escritas a mano
 *     (solo opción múltiple / verdadero-falso; se autocalifican sin OpenAI).
 *
 * El modo 'IA' es el actual (genera el quiz del contenido con gpt-4o-mini).
 * El modo 'MANUAL' sirve el set escrito por el admin y lo califica offline —
 * útil en MOSAICO mientras no haya OPENAI_API_KEY.
 *
 * Uso: node scripts/add-niveles-evaluacion-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const ALTERS = [
  ['evaluacionModo', `VARCHAR(10) DEFAULT 'IA'`],
  ['preguntasManual', `JSONB DEFAULT '[]'::jsonb`],
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
    // Normaliza NULLs previos (columnas agregadas antes sin default aplicado a filas viejas).
    await pool.query(`UPDATE "NIVELES" SET "evaluacionModo" = 'IA' WHERE "evaluacionModo" IS NULL`);
    await pool.query(`UPDATE "NIVELES" SET "preguntasManual" = '[]'::jsonb WHERE "preguntasManual" IS NULL`);
    const c = await pool.query(
      `SELECT "evaluacionModo", COUNT(*)::int n FROM "NIVELES" GROUP BY "evaluacionModo"`
    );
    console.log('✅ Columnas de evaluación agregadas. Modo por lección:',
      c.rows.map(r => `${r.evaluacionModo}=${r.n}`).join(', ') || '(sin filas)');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
