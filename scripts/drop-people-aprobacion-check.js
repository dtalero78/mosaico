/**
 * Elimina el CHECK `PEOPLE_aprobacion_check` (artefacto del seed de mosaico-db).
 *
 * El constraint solo admitía Aprobado/Pendiente/Rechazado/Contrato nulo/Devuelto
 * y BLOQUEABA valores que el motor SÍ escribe:
 *   - 'Retractado'  → cambio de estado post-aprobación ("Database error" al retractar)
 *   - 'FINALIZADA'  → cron expire-contracts y expiración al login (bug latente)
 *   - 'Aprobada'    → variante legacy tolerada en queries
 * En LGS no existe este CHECK: la validación de valores vive en la app (máquina
 * de estados del PATCH people/[id]).
 *
 * Idempotente (DROP CONSTRAINT IF EXISTS). Uso:
 *   node scripts/drop-people-aprobacion-check.js          # dry-run (muestra estado)
 *   node scripts/drop-people-aprobacion-check.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const c = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid = '"PEOPLE"'::regclass AND contype = 'c' AND conname = 'PEOPLE_aprobacion_check'`);
  if (!c.rowCount) { console.log('= PEOPLE_aprobacion_check no existe (nada que hacer)'); await pool.end(); return; }
  console.log('Encontrado:', c.rows[0].def);
  if (APPLY) {
    await pool.query(`ALTER TABLE "PEOPLE" DROP CONSTRAINT IF EXISTS "PEOPLE_aprobacion_check"`);
    console.log('✓ CHECK eliminado');
  } else {
    console.log('(dry-run — agrega --apply para eliminarlo)');
  }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
