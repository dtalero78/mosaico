/**
 * Agrega a PAGOS_TITULARES las columnas que el motor usa para la cuota #0 pero
 * que el seed mínimo de mosaico-db no creó:
 *   - "inscripcion" NUMERIC(12,2)   (valor de la inscripción)
 *   - "cuotasTotal" INTEGER          (nº de cuotas del plan)
 *   - "tipoCartera" VARCHAR(20) DEFAULT 'normal'
 * y convierte "plan" de numeric -> TEXT (el motor guarda Contado/Credito como texto).
 * Sin estas, el INSERT de la cuota #0 fallaba en silencio (best-effort) y el
 * pago de inscripción no se registraba (PAGOS_TITULARES quedaba vacía).
 * Idempotente. Uso: node scripts/add-pagos-titulares-missing-columns.js [--apply]
 */
const { Pool } = require('pg'); require('dotenv').config({ path: '.env.local' });
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const stmts = [
  `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "inscripcion" NUMERIC(12,2)`,
  `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "cuotasTotal" INTEGER`,
  `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "tipoCartera" VARCHAR(20) DEFAULT 'normal'`,
  `ALTER TABLE "PAGOS_TITULARES" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text`,
];
(async()=>{
  if(!apply){stmts.forEach(s=>console.log('[dry-run]',s));await pool.end();return;}
  for(const s of stmts) await pool.query(s);
  const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='PAGOS_TITULARES' AND column_name IN ('inscripcion','cuotasTotal','tipoCartera') ORDER BY column_name`);
  console.log('OK — columnas:', c.rows.map(x=>x.column_name).join(', '));
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
