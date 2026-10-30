/**
 * `FESTIVOS_PERSONALIZADOS` gana el ALCANCE del festivo: a qué cursos aplica.
 *   alcance  TODOS | MOSAICO | IMPULSA | CURSOS   (los existentes quedan en TODOS)
 *   cursoIds JSONB  ids de CURSOS_CAMPAIGN cuando alcance = CURSOS
 * IMPULSA nunca se regenera con el motor de MOSAICO (calendario propio): el alcance
 * IMPULSA sólo deja el día registrado.
 * Idempotente. Uso: node scripts/add-festivos-alcance.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='FESTIVOS_PERSONALIZADOS' AND column_name IN ('alcance','cursoIds')`);
  console.log('columnas existentes:', rows.map(r => r.column_name).join(', ') || '(ninguna)');
  if (!APPLY) { console.log('Dry-run. --apply para aplicar.'); await pool.end(); return; }
  await pool.query(`SET lock_timeout = '5s'`);
  await pool.query(`ALTER TABLE "FESTIVOS_PERSONALIZADOS" ADD COLUMN IF NOT EXISTS "alcance" VARCHAR(10) NOT NULL DEFAULT 'TODOS'`);
  await pool.query(`ALTER TABLE "FESTIVOS_PERSONALIZADOS" ADD COLUMN IF NOT EXISTS "cursoIds" JSONB NOT NULL DEFAULT '[]'::jsonb`);
  const { rows: [n] } = await pool.query(`SELECT COUNT(*)::int c FROM "FESTIVOS_PERSONALIZADOS"`);
  console.log(`listo — ${n.c} festivo(s), todos con alcance TODOS por defecto`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
