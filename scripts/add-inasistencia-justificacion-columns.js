/**
 * INASISTENCIA_GESTION += "justificadoPor" / "justificadoPorNombre" / "justificadoEn".
 *
 * Servicio › Gestión Justificación (y la pestaña "Justificaciones" del Panel Guía)
 * marca una inasistencia como falta justificada. La marca y el motivo viven en el
 * AGENDAMIENTO (ACADEMICA_BOOKINGS.escusa / justificaescusa), que es lo que leen
 * la ficha del alumno, el panel de la sesión y el avance de IMPULSA. Aquí sólo se
 * guarda QUIÉN la justificó y CUÁNDO — el agendamiento no tiene dónde guardarlo.
 *
 * Uso: node scripts/add-inasistencia-justificacion-columns.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const COLS = [
  ['justificadoPor', 'TEXT'],
  ['justificadoPorNombre', 'TEXT'],
  ['justificadoEn', 'TIMESTAMPTZ'],
];

(async () => {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'INASISTENCIA_GESTION'`
  );
  const existentes = new Set(rows.map(r => r.column_name));
  if (!existentes.size) {
    console.error('✗ La tabla INASISTENCIA_GESTION no existe: corre antes scripts/create-inasistencia-gestion-table.js');
    process.exitCode = 1;
    await pool.end();
    return;
  }
  for (const [c] of COLS) console.log(`  ${c}: ${existentes.has(c) ? 'ya existe' : 'falta'}`);

  if (!APPLY) {
    console.log('(dry-run) Reejecuta con --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    for (const [c, t] of COLS) {
      await client.query(`ALTER TABLE "INASISTENCIA_GESTION" ADD COLUMN IF NOT EXISTS "${c}" ${t}`);
    }
    await client.query('COMMIT');
    console.log('✓ Columnas de justificación creadas en INASISTENCIA_GESTION.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✗', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
