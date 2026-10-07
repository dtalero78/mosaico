/**
 * PEOPLE."modulo" BOOLEAN NOT NULL DEFAULT false — marca al TITULAR de un
 * contrato "Módulo" (vigencia fija de 3 meses). La pone Crear Contrato con el
 * botón «Módulo» del paso Financiero; la lee Comercial › Vencimientos.
 *
 * Los contratos existentes quedan en false: el dato no existía y no se deduce
 * de la vigencia (un contrato de 3 meses no es necesariamente un módulo).
 *
 * Uso: node scripts/add-people-modulo.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows: col } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'PEOPLE' AND column_name = 'modulo'`
  );
  console.log(`Columna PEOPLE.modulo: ${col.length ? 'ya existe' : 'falta'}`);

  if (!APPLY) {
    console.log('(dry-run) Reejecuta con --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Sin lock_timeout un ALTER encolado detrás de una consulta larga bloquea a
    // toda la aplicación mientras espera.
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "modulo" BOOLEAN NOT NULL DEFAULT false`);
    await client.query('COMMIT');
    console.log('✓ PEOPLE.modulo creada (false para todos los registros existentes).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✗', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
