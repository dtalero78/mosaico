/**
 * Marca los cierres del Reporte Académico que fueron una decisión ADMINISTRATIVA
 * en bloque, para poder distinguirlos de los que la Coordinación cerró porque el
 * Guía no lo hizo.
 *
 * Por qué hace falta: el contador de "Gestión Coordinación" mide desempeño del
 * Guía. Un cierre en bloque de una campaña entera —porque todavía no tiene los
 * alumnos definidos— no es un incumplimiento de nadie, y contarlo dejaría a los
 * guías con cientos de informes en su contra por algo que no depende de ellos.
 *
 * Idempotente. Uso:
 *   node scripts/add-cierre-masivo-column.js [--marcar-por=correo] [--campanas=A,B] [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : null;
};
const APPLY = process.argv.includes('--apply');
const POR = (arg('marcar-por') || '').trim();
const CAMPANAS = (arg('campanas') || '').split(',').map((s) => s.trim()).filter(Boolean);

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='REPORTE_ACADEMICO_CIERRE' AND column_name='cerradoMasivo'`);
  if (!col.rowCount) {
    console.log('Falta la columna "cerradoMasivo".');
    if (APPLY) {
      await pool.query(
        `ALTER TABLE "REPORTE_ACADEMICO_CIERRE"
           ADD COLUMN IF NOT EXISTS "cerradoMasivo" BOOLEAN NOT NULL DEFAULT false`);
      console.log('  → creada.');
    } else {
      console.log('  → se crearía con --apply.');
      await pool.end(); return;
    }
  } else {
    console.log('La columna "cerradoMasivo" ya existe.');
  }

  if (!POR || !CAMPANAS.length) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE "cerradoMasivo")::int AS marcados,
              COUNT(*)::int AS total FROM "REPORTE_ACADEMICO_CIERRE"`);
    console.log(`\nCierres marcados como masivos: ${rows[0].marcados} de ${rows[0].total}`);
    console.log('Para marcar un lote: --marcar-por=<correo> --campanas=A,B [--apply]\n');
    await pool.end(); return;
  }

  // Sólo los que cerró ese autor SIN que el Guía los hubiera cerrado antes: los
  // que el Guía sí cerró no son un cierre administrativo aunque estén en la lista.
  const where = `"cerradoAdminPor" = $1 AND "cerradoGuiaPor" IS NULL
                 AND "campaign" = ANY($2::text[]) AND "cerradoMasivo" IS NOT TRUE`;
  const { rows: prev } = await pool.query(
    `SELECT "campaign", COUNT(*)::int n FROM "REPORTE_ACADEMICO_CIERRE"
      WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, [POR, CAMPANAS]);
  const total = prev.reduce((a, r) => a + r.n, 0);
  console.log(`\nA marcar como masivos: ${total}`);
  prev.forEach((r) => console.log(`   ${String(r.campaign).padEnd(20)} ${String(r.n).padStart(5)}`));

  if (!APPLY) { console.log('\nEnsayo. Correr con --apply.\n'); await pool.end(); return; }

  const r = await pool.query(
    `UPDATE "REPORTE_ACADEMICO_CIERRE" SET "cerradoMasivo" = true, "_updatedDate" = NOW()
      WHERE ${where}`, [POR, CAMPANAS]);
  console.log(`\n✓ Marcados ${r.rowCount}.\n`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
