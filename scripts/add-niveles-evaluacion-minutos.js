/**
 * add-niveles-evaluacion-minutos.js
 *
 * Agrega NIVELES."evaluacionMinutos" (INTEGER, nullable) — duración del temporizador
 * de la evaluación/entrenamiento que ve el alumno. NULL = 30 min (fallback en código).
 * Idempotente.
 *
 * Uso: node scripts/add-niveles-evaluacion-minutos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  const sql = `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "evaluacionMinutos" INTEGER`;
  console.log('  ' + sql);
  if (APPLY) await pool.query(sql);
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='NIVELES' AND column_name='evaluacionMinutos'`
  );
  console.log(`\n  NIVELES."evaluacionMinutos": ${r.rows.length ? '✅' : '❌ (falta)'}`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
