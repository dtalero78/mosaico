/**
 * Migración MOSAICO — columnas de Crear Contrato (cursos + apoderado).
 *
 * PEOPLE += :
 *   - tipoCurso         VARCHAR(50)   (YOJI/OKINA/KODOMO/DANSHI/SENPAI/IMPULSA) — por beneficiario
 *   - horarioCurso      VARCHAR(120)  — por beneficiario
 *   - campaign          VARCHAR(120)  — por beneficiario
 *   - apoderado         VARCHAR(255)  — en la fila del TITULAR (1 por contrato)
 *   - apoderadoTelefono VARCHAR(50)
 *   - apoderadoMail     VARCHAR(255)
 *   - esCursoImpulsa    BOOLEAN DEFAULT false — en TITULAR; determina segmento I6 del N° contrato
 *
 * Uso: NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/add-mosaico-contrato-columns.js
 * Idempotente: ADD COLUMN IF NOT EXISTS. Solo BD de MOSAICO.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const COLUMNS = [
  ['tipoCurso', 'VARCHAR(50)'],
  ['horarioCurso', 'VARCHAR(120)'],
  ['campaign', 'VARCHAR(120)'],
  ['apoderado', 'VARCHAR(255)'],
  ['apoderadoTelefono', 'VARCHAR(50)'],
  ['apoderadoMail', 'VARCHAR(255)'],
  ['esCursoImpulsa', 'BOOLEAN DEFAULT false'],
  ['extemporanea', 'BOOLEAN DEFAULT false'],
  ['salon', 'VARCHAR(120)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, type] of COLUMNS) {
      await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
      console.log(`  ✓ PEOPLE."${col}" ${type}`);
    }
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='PEOPLE' AND column_name = ANY($1)`,
      [COLUMNS.map(c => c[0])]
    );
    console.log(`✅ Columnas presentes: ${r.rows.map(x => x.column_name).join(', ')}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
