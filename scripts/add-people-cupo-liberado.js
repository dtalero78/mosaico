/**
 * Agrega a PEOPLE el control MANUAL del cupo del beneficiario:
 *   "cupoLiberado"    BOOLEAN DEFAULT false  — true = el admin liberó el cupo a mano
 *   "cupoLiberadoPor" TEXT                   — quién lo liberó/retomó
 *   "cupoLiberadoEn"  TIMESTAMPTZ            — cuándo
 *
 * Se SUMA a la regla automática de `src/lib/cupo.ts` (que ya libera el cupo cuando
 * el titular queda Rechazado/Retractado/Contrato nulo, cuando el beneficiario entra
 * en OnHold o cuando un admin lo inactiva). Este campo es un override explícito para
 * abrir un cupo sin tener que inactivar al beneficiario ni cambiar el contrato.
 *
 * Sólo aplica a `tipoUsuario` BENEFICIARIO: el cupo es del alumno en su salón.
 * Con el contrato APROBADO el cupo queda bloqueado (decisión del usuario): la
 * liberación se rechaza en el endpoint, no sólo en la interfaz.
 *
 * Todas las filas arrancan en false = nadie pierde su cupo por esta migración.
 *
 * Uso: node scripts/add-people-cupo-liberado.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoLiberado"    BOOLEAN DEFAULT false;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoLiberadoPor" TEXT;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoLiberadoEn"  TIMESTAMPTZ;
UPDATE "PEOPLE" SET "cupoLiberado" = false WHERE "cupoLiberado" IS NULL;
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name IN ('cupoLiberado','cupoLiberadoPor','cupoLiberadoEn')`
  );
  if (pre.length === 3) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "PEOPLE" WHERE "cupoLiberado" IS TRUE`);
    console.log(`✓ Las 3 columnas ya existen (${n} beneficiario(s) con el cupo liberado a mano).`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log(`Faltan ${3 - pre.length} de 3 columnas.\n(dry-run) Se ejecutaría:\n`);
    console.log(DDL);
    console.log('Reejecuta con --apply.');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name LIKE 'cupoLiberado%' ORDER BY column_name`
  );
  console.log('✅ Columnas creadas:');
  console.table(rows);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
