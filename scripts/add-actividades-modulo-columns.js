/**
 * add-actividades-modulo-columns.js
 *
 * Actividad Kahoot/WordWall a nivel MÓDULO (visible para todos los alumnos del
 * módulo, sin importar la lección). Se guardan en todas las filas del módulo,
 * igual que descripcionModulo/recursos.
 *   NIVELES."actividadKahootModulo" / ..."actividadKahootModuloNombre"
 *   NIVELES."actividadWordwallModulo" / ..."actividadWordwallModuloNombre"
 * Idempotente.
 *
 * Uso: node scripts/add-actividades-modulo-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const APPLY = process.argv.includes('--apply');
const url = (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const COLS = ['actividadKahootModulo', 'actividadKahootModuloNombre', 'actividadWordwallModulo', 'actividadWordwallModuloNombre'];

(async () => {
  console.log(APPLY ? '🔴 APPLY' : '🟡 DRY-RUN');
  for (const c of COLS) {
    const sql = `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "${c}" TEXT`;
    console.log('  ' + sql);
    if (APPLY) await pool.query(sql);
  }
  const r = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name='NIVELES' AND column_name = ANY($1)`,
    [COLS]
  );
  console.log(`\n  Columnas presentes: ${r.rows[0].n}/${COLS.length}`);
  if (!APPLY) console.log('  (dry-run — corre con --apply)');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
