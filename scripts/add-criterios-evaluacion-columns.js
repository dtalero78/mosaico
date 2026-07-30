/**
 * add-criterios-evaluacion-columns.js
 *
 * Criterios de evaluación por sesión (panel de Guía). Agrega (idempotente) 7
 * columnas booleanas a ACADEMICA_BOOKINGS, una por criterio nuevo. Las 2
 * restantes REUSAN columnas existentes:
 *   - HE_ASISTENCIA    → asistencia / asistio  (ya existen)
 *   - DA_PARTICIPACION → participacion         (ya existe)
 *
 * Nuevas (BOOLEAN DEFAULT false):
 *   Hábitos:    hePuntualidad, heAsignacion
 *   Desempeño:  daDominio, daDesafio
 *   Actitudes:  acPermanencia, acRespeto, acDisposicion
 *
 * Uso: node scripts/add-criterios-evaluacion-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const COLS = [
  'hePuntualidad', 'heAsignacion',      // Hábitos
  'daDominio', 'daDesafio',             // Desempeño
  'acPermanencia', 'acRespeto', 'acDisposicion', // Actitudes
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const c of COLS) {
    const sql = `ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "${c}" BOOLEAN DEFAULT false`;
    console.log('  ' + sql);
    if (APPLY) await pool.query(sql);
  }
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='ACADEMICA_BOOKINGS' AND column_name = ANY($1)`,
    [COLS]
  );
  const found = new Set(r.rows.map(x => x.column_name));
  console.log('\n  Verificación:');
  for (const c of COLS) console.log(`   ${found.has(c) ? '✅' : '❌'} ${c}`);
  if (!APPLY) console.log('\n  (dry-run — corre con --apply)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
