/**
 * Agrega a PEOPLE la marca de "quitado de la lista En Gestión":
 *   "enGestionQuitadoEn"  TIMESTAMPTZ   — cuándo se quitó (NULL = sigue en la lista)
 *   "enGestionQuitadoPor" VARCHAR(255)  — correo de quien lo quitó
 *
 * La lista "En Gestión" de Comercial › Gestión Contrato muestra los contratos
 * creados en las últimas horas que todavía no están listos ni aprobados. Esta
 * marca es la opción de sacar uno a mano. NO borra ni cambia el contrato: sólo lo
 * esconde de esa lista, y se puede restaurar.
 *
 * Se guarda el INSTANTE y no un booleano —mismo patrón que `listoAprobacion`—
 * para que quede constancia de cuándo se quitó y por quién. Sólo aplica a la fila
 * del TITULAR.
 *
 * Todas las filas arrancan en NULL: nadie quitó nada todavía.
 *
 * Uso: node scripts/add-people-en-gestion-quitado.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COLS = ['enGestionQuitadoEn', 'enGestionQuitadoPor'];
const DDL = `
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "enGestionQuitadoEn"  TIMESTAMPTZ;
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "enGestionQuitadoPor" VARCHAR(255);
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name = ANY($1)`, [COLS]
  );
  if (pre.length === COLS.length) {
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "PEOPLE" WHERE "enGestionQuitadoEn" IS NOT NULL`
    );
    console.log(`✓ Las columnas ya existen (${n} contrato(s) quitados de la lista).`);
    await pool.end();
    return;
  }
  const faltan = COLS.filter(c => !pre.some(p => p.column_name === c));
  if (!APPLY) {
    console.log(`Faltan: ${faltan.join(', ')}.\n(dry-run) Se ejecutaría:\n`);
    console.log(DDL);
    console.log('Reejecuta con --apply.');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name = ANY($1) ORDER BY 1`, [COLS]
  );
  console.log('✅ Columnas creadas:');
  console.table(rows);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
