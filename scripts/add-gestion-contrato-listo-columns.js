/**
 * add-gestion-contrato-listo-columns.js
 *
 * Flag "Dejar listo" de Comercial › Gestión Contrato: marca un contrato firmado
 * sin aprobar como gestionado (documentación completa) → sale de la lista.
 *   PEOPLE."gestionContratoListo" BOOLEAN DEFAULT false
 *   PEOPLE."gestionContratoListoBy" TEXT / ..."gestionContratoListoDate" TIMESTAMPTZ
 * Idempotente.
 *
 * Uso: node scripts/add-gestion-contrato-listo-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STMTS = [
  `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "gestionContratoListo" BOOLEAN DEFAULT false`,
  `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "gestionContratoListoBy" TEXT`,
  `ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "gestionContratoListoDate" TIMESTAMPTZ`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const s of STMTS) { console.log('  ' + s); if (APPLY) await pool.query(s); }
  const r = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='PEOPLE' AND column_name IN ('gestionContratoListo','gestionContratoListoBy','gestionContratoListoDate')`
  );
  console.log(`\n  Columnas presentes: ${r.rows[0].n}/3`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
