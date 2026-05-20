/**
 * One-time DDL: PAGOS_TITULARES
 *  1) ADD COLUMN cuotasTotal INTEGER  → total de cuotas del contrato.
 *     Se llena en el INSERT de cuota #0 desde financial.numeroCuotas y permite
 *     calcular cuotas restantes = cuotasTotal − COUNT(validados con numCuota > 0).
 *  2) ALTER COLUMN plan TYPE INTEGER USING ROUND(plan)
 *     plan es un índice a tabla de planes (futura), nunca decimal.
 *
 * Idempotente:
 *   - ADD COLUMN IF NOT EXISTS para cuotasTotal.
 *   - Detecta tipo actual de plan antes de alterar (skip si ya es integer).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1) cuotasTotal
    await pool.query(`
      ALTER TABLE "PAGOS_TITULARES"
      ADD COLUMN IF NOT EXISTS "cuotasTotal" INTEGER
    `);
    const ctCol = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' AND column_name='cuotasTotal'`
    );
    console.log(`OK — cuotasTotal: ${ctCol.rows[0]?.data_type ?? 'no se detectó'}`);

    // 2) plan → INTEGER
    const planCol = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='PAGOS_TITULARES' AND column_name='plan'`
    );
    const planType = planCol.rows[0]?.data_type;
    if (planType === 'integer') {
      console.log('OK — plan ya es integer, skip');
    } else {
      // ROUND maneja valores como 12.00 → 12. NULL queda NULL.
      await pool.query(`
        ALTER TABLE "PAGOS_TITULARES"
        ALTER COLUMN "plan" TYPE INTEGER
        USING ROUND("plan")::integer
      `);
      const planColAfter = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name='PAGOS_TITULARES' AND column_name='plan'`
      );
      console.log(`OK — plan: ${planType} → ${planColAfter.rows[0]?.data_type}`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
