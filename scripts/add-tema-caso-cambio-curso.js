/**
 * MOSAICO — Agrega el valor CAMBIO_CURSO al ENUM tema_caso (Casos de Atención).
 * Es la etiqueta «Cambio de curso» de los casos que genera «Búsqueda Lección».
 * Idempotente; ensayo por defecto.
 *
 * Uso: node scripts/add-tema-caso-cambio-curso.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='tema_caso' ORDER BY e.enumsortorder`);
  const ya = rows.some(r => r.enumlabel === 'CAMBIO_CURSO');
  console.log('Valores actuales:', rows.map(r => r.enumlabel).join(', '));
  console.log(ya ? 'CAMBIO_CURSO ya existe.' : 'CAMBIO_CURSO NO existe → se agrega.');
  if (APPLY && !ya) {
    await pool.query(`SET lock_timeout='5s'`);
    await pool.query(`ALTER TYPE tema_caso ADD VALUE IF NOT EXISTS 'CAMBIO_CURSO'`);
    console.log('✅ valor agregado');
  } else if (!APPLY && !ya) console.log('(ensayo) usa --apply');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
