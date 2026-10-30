/**
 * `EVALUACION_RESPUESTAS` gana el reseteo de intentos (Mis alumnos › Resetear última evaluación):
 *   reseteado   BOOLEAN  — el intento ya no cuenta para el tope de 3 (el historial se conserva)
 *   reseteadoPor / reseteadoEn
 * Idempotente. Uso: node scripts/add-evaluacion-reseteo.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='EVALUACION_RESPUESTAS' AND column_name IN ('reseteado','reseteadoPor','reseteadoEn')`);
  console.log('existentes:', rows.map(r => r.column_name).join(', ') || '(ninguna)');
  if (!APPLY) { console.log('Dry-run. --apply para aplicar.'); return pool.end(); }
  await pool.query(`SET lock_timeout = '5s'`);
  await pool.query(`ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "reseteado" BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "reseteadoPor" VARCHAR(255)`);
  await pool.query(`ALTER TABLE "EVALUACION_RESPUESTAS" ADD COLUMN IF NOT EXISTS "reseteadoEn" TIMESTAMPTZ`);
  console.log('listo');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
