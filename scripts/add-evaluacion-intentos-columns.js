/**
 * add-evaluacion-intentos-columns.js
 *
 * Evaluaciones con INTENTOS: cada fila de EVALUACION_RESPUESTAS es un intento de un
 * cuestionario. Se agregan:
 *   - "intento"    INT      (1..3)
 *   - "aprobado"   BOOLEAN  (porcentaje >= 60)
 *   - "porcentaje" INT      (score/total*100)
 * Idempotente.
 *
 * Uso: node scripts/add-evaluacion-intentos-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STMTS = [
  `ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "intento" INTEGER`,
  `ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "aprobado" BOOLEAN`,
  `ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "porcentaje" INTEGER`,
  // Backfill de filas viejas: 1 intento, porcentaje y aprobado desde score/total.
  `UPDATE "EVALUACION_RESPUESTAS"
      SET "intento" = COALESCE("intento",1),
          "porcentaje" = COALESCE("porcentaje", CASE WHEN COALESCE("total",0)>0 THEN ROUND("score"::numeric*100/"total") ELSE 0 END),
          "aprobado" = COALESCE("aprobado", (CASE WHEN COALESCE("total",0)>0 THEN "score"::numeric*100/"total" ELSE 0 END) >= 60)
    WHERE "intento" IS NULL`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const s of STMTS) { console.log('  ' + s.split('\n')[0] + ' …'); if (APPLY) await pool.query(s); }
  const r = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='EVALUACION_RESPUESTAS' AND column_name IN ('intento','aprobado','porcentaje')`
  );
  console.log(`\n  Columnas presentes: ${r.rows[0].n}/3`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
