// Migración V2 de Performance Evaluation — idempotente.
//
//   1. Recalcula "promedio" de las filas existentes con las 4 dimensiones que quedan
//      (puntualidad, claridad, actividades, ambiente). Antes era /6 con motivacion +
//      satisfaccionGeneral incluidas — el v2 trabaja con /4.
//   2. DROP COLUMN "motivacion" y "satisfaccionGeneral" (IF EXISTS).
//
// Re-ejecutable. Si las columnas ya no existen, los DROPs son no-op.
//
//   node scripts/evaluations-v2-migration.js
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1) ¿Existen las columnas?
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ACADEMICA_BOOKING_EVALUATIONS'
         AND column_name IN ('motivacion','satisfaccionGeneral','puntualidad','claridad','actividades','ambiente')`
    );
    const present = new Set(cols.rows.map(r => r.column_name));
    const hasMot = present.has('motivacion');
    const hasSat = present.has('satisfaccionGeneral');

    if (!hasMot && !hasSat) {
      console.log('✅ Columnas motivacion / satisfaccionGeneral ya fueron eliminadas. Nada que hacer.');
      const c = await pool.query(`SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKING_EVALUATIONS"`);
      console.log(`   Filas actuales: ${c.rows[0].n}`);
      return;
    }

    // 2) Recalcular promedio /4 ANTES de droppear.
    if (hasMot || hasSat) {
      const upd = await pool.query(
        `UPDATE "ACADEMICA_BOOKING_EVALUATIONS"
         SET "promedio" = ROUND(
           (("puntualidad" + "claridad" + "actividades" + "ambiente")::numeric / 4.0)::numeric, 2
         )`
      );
      console.log(`✅ Promedio recalculado (/4) para ${upd.rowCount} fila(s) existente(s).`);
    }

    // 3) DROP COLUMN (idempotente).
    if (hasMot) {
      await pool.query(`ALTER TABLE "ACADEMICA_BOOKING_EVALUATIONS" DROP COLUMN IF EXISTS "motivacion"`);
      console.log('✅ DROP COLUMN motivacion.');
    }
    if (hasSat) {
      await pool.query(`ALTER TABLE "ACADEMICA_BOOKING_EVALUATIONS" DROP COLUMN IF EXISTS "satisfaccionGeneral"`);
      console.log('✅ DROP COLUMN satisfaccionGeneral.');
    }

    // 4) Verificación final.
    const after = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ACADEMICA_BOOKING_EVALUATIONS'
       ORDER BY ordinal_position`
    );
    console.log('\n📋 Columnas finales:');
    after.rows.forEach(r => console.log('   -', r.column_name));
    const cnt = await pool.query(`SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKING_EVALUATIONS"`);
    console.log(`\n   Filas totales: ${cnt.rows[0].n}`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
