/**
 * add-caso-atencion-columns.js
 *
 * Agrega (idempotente) las columnas del feature "Casos de Atención":
 *   - ACADEMICA_BOOKINGS."casoAtencion"       BOOLEAN DEFAULT false
 *       Se marca true cuando el guía escribe un caso de atención para ese
 *       (estudiante, evento) en /sesion/[id].
 *   - ACADEMICA."historicCasoAtencion"        JSONB DEFAULT '[]'
 *       Historial de casos resueltos del estudiante (mismo tipo que
 *       cambioAcademicoHistory): {fecha, comentario, evento, resueltoPor…}.
 *
 * Uso:
 *   node scripts/add-caso-atencion-columns.js            (dry-run)
 *   node scripts/add-caso-atencion-columns.js --apply
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STATEMENTS = [
  `ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "casoAtencion" BOOLEAN DEFAULT false`,
  `ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "historicCasoAtencion" JSONB DEFAULT '[]'::jsonb`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const sql of STATEMENTS) {
    console.log('  ' + sql);
    if (APPLY) await pool.query(sql);
  }
  // Verificación
  const b = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ACADEMICA_BOOKINGS' AND column_name='casoAtencion'`);
  const a = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='ACADEMICA' AND column_name='historicCasoAtencion'`);
  console.log(`\n  ACADEMICA_BOOKINGS.casoAtencion: ${b.rowCount ? '✅' : '❌ (falta)'}`);
  console.log(`  ACADEMICA.historicCasoAtencion:  ${a.rowCount ? '✅' : '❌ (falta)'}`);
  if (!APPLY) console.log('\n  (dry-run — corre con --apply para aplicar)');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
