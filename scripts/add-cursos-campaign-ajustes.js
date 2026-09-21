/**
 * Agrega a CURSOS_CAMPAIGN lo que necesita Académico › Campañas › Ajuste Cursos:
 *
 *   "cierreCurso"    DATE   — fecha de la última clase fijada por un CIERRE. El
 *                             generador de eventos nunca agenda después de ella: sin
 *                             este tope, regenerar el curso correría al final las
 *                             clases que caen en festivo y volverían a aparecer
 *                             clases posteriores al cierre.
 *   "ajustesHistory" JSONB  — un registro por cierre o ampliación (quién, cuándo,
 *                             motivo, fechas antes/después, clases y agendamientos
 *                             que cambiaron, guía). Append-only. Un curso con al
 *                             menos un ajuste ya no se edita desde Gestión.
 *
 * Idempotente. Uso: node scripts/add-cursos-campaign-ajustes.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const DDL = [
  `ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "cierreCurso" DATE`,
  `ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "ajustesHistory" JSONB NOT NULL DEFAULT '[]'::jsonb`,
];

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/([?&])sslmode=[^&]*/i, '$1sslmode=no-verify'),
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows: antes } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'CURSOS_CAMPAIGN' AND column_name IN ('cierreCurso','ajustesHistory')`
    );
    const { rows: [n] } = await pool.query(`SELECT COUNT(*)::int AS cursos FROM "CURSOS_CAMPAIGN"`);
    console.log(`Cursos en la tabla: ${n.cursos}`);
    console.log(`Columnas ya presentes: ${antes.map(r => r.column_name + ' (' + r.data_type + ')').join(', ') || 'ninguna'}`);

    if (!APPLY) {
      console.log('\n[ENSAYO] Se ejecutaría:');
      DDL.forEach(s => console.log('  ' + s));
      console.log('\nUsa --apply para aplicar.');
      return;
    }

    for (const s of DDL) await pool.query(s);
    const { rows: despues } = await pool.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
        WHERE table_name = 'CURSOS_CAMPAIGN' AND column_name IN ('cierreCurso','ajustesHistory')`
    );
    console.log('\nAPLICADO:');
    despues.forEach(r => console.log(`  ${r.column_name}: ${r.data_type} ${r.column_default ? 'default ' + r.column_default : ''}`));
    const { rows: [chk] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE "cierreCurso" IS NOT NULL)::int AS con_cierre,
              COUNT(*) FILTER (WHERE jsonb_array_length("ajustesHistory") > 0)::int AS con_ajustes
         FROM "CURSOS_CAMPAIGN"`
    );
    console.log(`  cursos con cierre: ${chk.con_cierre} · con ajustes: ${chk.con_ajustes} (ambos deben ser 0)`);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
