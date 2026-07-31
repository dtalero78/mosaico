/**
 * add-cuestionarios-columns.js
 *
 * Soporte de MÚLTIPLES cuestionarios por lección de Evaluación:
 *  - NIVELES."cuestionarios" JSONB DEFAULT '[]'  → [{id,titulo,minutos,preguntas:[...]}]
 *  - EVALUACION_RESPUESTAS."cuestionarioId" TEXT / "cuestionarioTitulo" TEXT
 *    (para registrar qué cuestionario presentó el alumno).
 * Idempotente. No migra datos: las lecciones con preguntasManual siguen válidas
 * (se tratan como 1 cuestionario por compatibilidad en el código).
 *
 * Uso: node scripts/add-cuestionarios-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STMTS = [
  `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "cuestionarios" JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "cuestionarioId" TEXT`,
  `ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "cuestionarioTitulo" TEXT`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const s of STMTS) { console.log('  ' + s); if (APPLY) await pool.query(s); }
  const chk = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='NIVELES' AND column_name='cuestionarios') AS niv,
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='EVALUACION_RESPUESTAS' AND column_name IN ('cuestionarioId','cuestionarioTitulo')) AS resp`
  );
  console.log(`\n  NIVELES.cuestionarios: ${chk.rows[0].niv > 0 ? '✅' : '❌'} · EVALUACION_RESPUESTAS cols: ${chk.rows[0].resp}/2`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
