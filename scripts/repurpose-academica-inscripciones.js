/**
 * Repurposa columnas MUERTAS de ACADEMICA (heredadas de Wix, sin uso real) para el
 * feature de inscripciones. SOLO toca ACADEMICA — los campos de PEOPLE (vigencia,
 * extensionCount, extensionHistory del sistema de extensiones) NO se tocan.
 *
 *   ACADEMICA."inscripciones"   integer → boolean
 *   ACADEMICA."extensionCount"  → renombra a "apruebaInscripsion" + tipo boolean
 *   ACADEMICA."extensionHistory"→ renombra a "detalleInscripcion" (sigue jsonb)
 *
 * Idempotente. Uso: node scripts/repurpose-academica-inscripciones.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false } });

async function colInfo(pool, name) {
  const r = await pool.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name=$1`, [name]);
  return r.rows[0]?.data_type || null;
}

(async () => {
  const steps = [];

  // 1) inscripciones: integer → boolean
  const insType = await colInfo(pool, 'inscripciones');
  if (insType === 'integer') {
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "inscripciones" DROP DEFAULT`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "inscripciones" TYPE boolean USING (CASE WHEN "inscripciones" IS NULL THEN NULL ELSE "inscripciones" <> 0 END)`);
  } else if (insType === 'boolean') { console.log('= inscripciones ya es boolean'); }
  else if (!insType) { console.log('⚠ inscripciones no existe'); }

  // 2) extensionCount → apruebaInscripsion (boolean)
  const ecType = await colInfo(pool, 'extensionCount');
  const aiType = await colInfo(pool, 'apruebaInscripsion');
  if (ecType && !aiType) {
    steps.push(`ALTER TABLE "ACADEMICA" RENAME COLUMN "extensionCount" TO "apruebaInscripsion"`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" DROP DEFAULT`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" TYPE boolean USING (CASE WHEN "apruebaInscripsion" IS NULL THEN NULL ELSE "apruebaInscripsion" <> 0 END)`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" SET DEFAULT false`);
  } else if (aiType === 'integer') {
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" DROP DEFAULT`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" TYPE boolean USING (CASE WHEN "apruebaInscripsion" IS NULL THEN NULL ELSE "apruebaInscripsion" <> 0 END)`);
    steps.push(`ALTER TABLE "ACADEMICA" ALTER COLUMN "apruebaInscripsion" SET DEFAULT false`);
  } else if (aiType === 'boolean') { console.log('= apruebaInscripsion ya es boolean'); }

  // 3) extensionHistory → detalleInscripcion (sigue jsonb)
  const ehType = await colInfo(pool, 'extensionHistory');
  const diType = await colInfo(pool, 'detalleInscripcion');
  if (ehType && !diType) {
    steps.push(`ALTER TABLE "ACADEMICA" RENAME COLUMN "extensionHistory" TO "detalleInscripcion"`);
  } else if (diType) { console.log('= detalleInscripcion ya existe'); }

  if (!steps.length) { console.log('Nada por hacer (ya aplicado). Idempotente.'); await pool.end(); return; }
  if (!apply) { console.log('[dry-run] SQL a ejecutar:'); steps.forEach(s => console.log('  ' + s)); console.log('(usa --apply)'); await pool.end(); return; }
  for (const s of steps) { await pool.query(s); console.log('✓', s); }

  const fin = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name IN ('inscripciones','apruebaInscripsion','detalleInscripcion','extensionCount','extensionHistory') ORDER BY column_name`);
  console.log('\nEstado final:', JSON.stringify(fin.rows));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
