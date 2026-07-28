/**
 * add-niveles-recursos-actividad-nombres.js
 *
 * NIVELES += 3 columnas para la pestaña "Recursos" del panel del estudiante y los
 * nombres de las actividades:
 *   - recursos               JSONB DEFAULT '[]'  → links del MÓDULO (array {nombre, link});
 *                                                   se replica en todas las lecciones del módulo
 *                                                   (igual que descripcionModulo).
 *   - actividadKahootNombre  TEXT   → nombre visible del link de Kahoot (por lección).
 *   - actividadWordwallNombre TEXT  → nombre visible del link de WordWall (por lección).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS). Uso:
 *   node scripts/add-niveles-recursos-actividad-nombres.js            (dry-run)
 *   node scripts/add-niveles-recursos-actividad-nombres.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const STMTS = [
  `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "recursos" JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "actividadKahootNombre" TEXT`,
  `ALTER TABLE "NIVELES" ADD COLUMN IF NOT EXISTS "actividadWordwallNombre" TEXT`,
];

(async () => {
  console.log(`\n=== NIVELES += recursos / actividad*Nombre ${APPLY ? '(APLICAR)' : '(DRY-RUN)'} ===\n`);
  for (const s of STMTS) console.log('  ' + s);
  if (!APPLY) { console.log('\n(dry-run — nada escrito. Agrega --apply.)'); await pool.end(); return; }
  for (const s of STMTS) await pool.query(s);
  const cols = (await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='NIVELES' AND column_name IN ('recursos','actividadKahootNombre','actividadWordwallNombre')
      ORDER BY column_name`
  )).rows;
  console.log('\n✔ Columnas presentes:');
  cols.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
