/**
 * Agrega a `ACADEMICA_BOOKINGS` las dos columnas de la ausencia justificada:
 *
 *   escusa           BOOLEAN DEFAULT false — la falta está justificada
 *   justificaescusa  TEXT                  — el motivo que se digita
 *
 * Son DOS columnas y no una sola de texto porque la marca y el motivo se
 * consultan distinto: la marca se cuenta (la tarjeta "Justificadas" del panel del
 * alumno) y el motivo se lee. Con sólo el texto habría que preguntar por
 * "distinto de vacío" en cada conteo, y una excusa marcada sin motivo escrito
 * dejaría de contarse.
 *
 * ⚠ Justificar NO descuenta la ausencia: la falta sigue siendo falta, y el
 * conteo de "Ausente" no se toca. La justificación es información adicional.
 *
 * Idempotente. Uso: node scripts/add-bookings-escusa-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COLUMNAS = [
  { nombre: 'escusa', ddl: '"escusa" BOOLEAN NOT NULL DEFAULT false' },
  { nombre: 'justificaescusa', ddl: '"justificaescusa" TEXT' },
];

(async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'ACADEMICA_BOOKINGS'`);
  const existentes = new Set(rows.map((r) => r.column_name));

  const faltan = COLUMNAS.filter((c) => !existentes.has(c.nombre));
  if (!faltan.length) {
    console.log('\n✓ Las dos columnas ya existen.');
  } else {
    console.log(`\nFaltan: ${faltan.map((c) => c.nombre).join(', ')}`);
    if (!APPLY) {
      console.log('Ensayo. Correr con --apply para crearlas.\n');
      await pool.end(); return;
    }
    for (const c of faltan) {
      await pool.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS ${c.ddl}`);
      console.log(`  → ${c.nombre} creada.`);
    }
  }

  const { rows: n } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE "escusa" IS TRUE)::int AS justificadas
       FROM "ACADEMICA_BOOKINGS"`);
  console.log(`\nAgendamientos: ${n[0].total} · justificados: ${n[0].justificadas}\n`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
