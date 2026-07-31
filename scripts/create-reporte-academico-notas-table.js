/**
 * create-reporte-academico-notas-table.js
 *
 * Guarda, por (estudiante · salón · semana), el comentario IA generado y la
 * valoración que escribe el Guía en el Reporte Académico. Idempotente.
 *
 * Uso: node scripts/create-reporte-academico-notas-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const STMTS = [
  `CREATE TABLE IF NOT EXISTS "REPORTE_ACADEMICO_NOTAS" (
     "_id"          TEXT PRIMARY KEY,
     "academicaId"  TEXT NOT NULL,
     "numeroId"     TEXT,
     "curso"        TEXT,
     "salon"        TEXT,
     "campaign"     TEXT,
     "semanaInicio" DATE NOT NULL,   -- lunes de la semana
     "comentarioIA" TEXT,
     "notaGuia"     TEXT,
     "updatedBy"    TEXT,
     "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
     "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_repnotas_unq ON "REPORTE_ACADEMICO_NOTAS"("academicaId","salon","semanaInicio")`,
];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const s of STMTS) { console.log('  ' + s.split('\n')[0] + ' …'); if (APPLY) await pool.query(s); }
  const r = await pool.query(`SELECT to_regclass('"REPORTE_ACADEMICO_NOTAS"') AS t`);
  console.log(`\n  REPORTE_ACADEMICO_NOTAS: ${r.rows[0].t ? '✅' : '❌ (falta)'}`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
