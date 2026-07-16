/**
 * Amplía el CHECK de CALENDARIO.tipo para admitir 'OLIMPIADA'.
 *
 * Sin esto, crear una Olimpiada revienta con "violates check constraint
 * CALENDARIO_tipo_check" (es exactamente lo que pasó al añadir NIVELACION —
 * ver scripts/add-calendario-tipo-nivelacion.js).
 *
 * Idempotente: si el CHECK ya admite OLIMPIADA no hace nada.
 *
 * Uso:
 *   node scripts/add-calendario-tipo-olimpiada.js           (dry-run)
 *   node scripts/add-calendario-tipo-olimpiada.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const TIPOS = ['SESSION', 'CLUB', 'WELCOME', 'COMPLEMENTARIA', 'NIVELACION', 'OLIMPIADA'];

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const r = await pool.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
        FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'CALENDARIO' AND con.contype = 'c' AND con.conname = 'CALENDARIO_tipo_check'`);

    if (r.rowCount === 0) {
      console.log('No existe CALENDARIO_tipo_check (nada que ampliar).');
      return;
    }
    console.log('CHECK actual:', r.rows[0].def);
    if (/OLIMPIADA/.test(r.rows[0].def)) {
      console.log('✅ Ya admite OLIMPIADA — nada que hacer.');
      return;
    }

    const lista = TIPOS.map((t) => `'${t}'::text`).join(', ');
    const sql = [
      `ALTER TABLE "CALENDARIO" DROP CONSTRAINT "CALENDARIO_tipo_check"`,
      `ALTER TABLE "CALENDARIO" ADD CONSTRAINT "CALENDARIO_tipo_check" CHECK (("tipo")::text = ANY (ARRAY[${lista}]))`,
    ];

    if (!APPLY) {
      console.log('\n--- DRY RUN (sin --apply no se escribe nada) ---');
      sql.forEach((s) => console.log('  ' + s + ';'));
      return;
    }

    // Una transacción: si el ADD falla, no queda la tabla SIN constraint.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const s of sql) await c.query(s);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

    const v = await pool.query(`
      SELECT pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'CALENDARIO' AND con.conname = 'CALENDARIO_tipo_check'`);
    console.log('✅ CHECK nuevo:', v.rows[0].def);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
