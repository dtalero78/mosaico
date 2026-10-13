/**
 * MOSAICO — columnas ACADEMICA."welcomePendienteMotivo" y "welcomePendienteDesde".
 *
 * Registran POR QUÉ un alumno creó su perfil sin agendar la bienvenida (la casilla
 * "Prefiero que Servicio me contacte", el enlace de sólo perfil, o que no había
 * sesiones) y desde cuándo. Son sólo la ETIQUETA del motivo: quién está en la cola
 * "Pendientes de agendar" se calcula al leer (sigue en WELCOME, con perfil y sin
 * ninguna bienvenida agendada), así que el alumno sale solo al agendarlo.
 *
 * Idempotente. Ensayo por defecto; --apply para escribir. Con lock_timeout para
 * no encolar a producción detrás de un ALTER.
 *   node scripts/add-academica-welcome-pendiente.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local', quiet: true });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const COLUMNAS = [
  ['welcomePendienteMotivo', 'VARCHAR(30)'],
  ['welcomePendienteDesde', 'TIMESTAMPTZ'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false }, max: 1,
  });
  try {
    const existentes = new Set((await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ACADEMICA' AND column_name = ANY($1)`,
      [COLUMNAS.map(([n]) => n)])).rows.map((r) => r.column_name));
    const faltan = COLUMNAS.filter(([n]) => !existentes.has(n));
    if (faltan.length === 0) { console.log('Las columnas ya existen. Nada que hacer.'); return; }
    if (!APPLY) {
      console.log(`Ensayo: se agregarían a ACADEMICA: ${faltan.map(([n, t]) => `"${n}" ${t}`).join(', ')}. Usa --apply.`);
      return;
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL lock_timeout = '5s'`);
      for (const [n, t] of faltan) {
        await c.query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "${n}" ${t}`);
      }
      await c.query('COMMIT');
      console.log(`✓ Columnas creadas: ${faltan.map(([n]) => n).join(', ')}`);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } finally { await pool.end(); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
