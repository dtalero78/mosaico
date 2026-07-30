/**
 * create-evaluacion-respuestas-table.js
 *
 * Tabla que guarda el EVENTO de presentación de una evaluación por alumno, con
 * sus respuestas (las evaluaciones que se generan por lección — módulos
 * Evaluación). Idempotente.
 *
 * Uso: node scripts/create-evaluacion-respuestas-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "EVALUACION_RESPUESTAS" (
     "_id"          TEXT PRIMARY KEY,
     "academicaId"  TEXT,
     "numeroId"     TEXT,
     "nombre"       TEXT,
     "curso"        TEXT,
     "code"         TEXT,          -- módulo (ej. Evaluacion 01)
     "step"         TEXT,          -- lección (ej. Leccion 16)
     "respuestas"   JSONB DEFAULT '[]'::jsonb,  -- [{qId, question, selected, correct, ok}]
     "score"        INTEGER,
     "total"        INTEGER,
     "iniciadaEn"   TIMESTAMPTZ,
     "enviadaEn"    TIMESTAMPTZ,
     "duracionSeg"  INTEGER,
     "_createdDate" TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_eval_resp_student ON "EVALUACION_RESPUESTAS"("academicaId")`,
  `CREATE INDEX IF NOT EXISTS idx_eval_resp_lesson  ON "EVALUACION_RESPUESTAS"("curso","code","step")`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const sql of STATEMENTS) {
    console.log('  ' + sql.split('\n')[0] + ' …');
    if (APPLY) await pool.query(sql);
  }
  const r = await pool.query(`SELECT to_regclass('"EVALUACION_RESPUESTAS"') AS t`);
  console.log(`\n  EVALUACION_RESPUESTAS: ${r.rows[0].t ? '✅' : '❌ (falta)'}`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
