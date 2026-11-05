/**
 * add-cambio-contado-columns.js
 *
 * Agrega a PAGOS_TITULARES las columnas del "Cambio Contado":
 *   - "cambioContado" BOOLEAN DEFAULT false — la casilla del formulario Registrar Pago.
 *   - "realizadopor"  VARCHAR(20)           — quién gestionó el cambio ('Comercial' |
 *     'Recaudos'). Sólo se llena con cambioContado=true; lo DERIVA el servidor con la
 *     regla de src/lib/cambio-contado.ts (el cliente nunca lo envía).
 *   - "nota"          TEXT                  — motivo; obligatoria con Cambio Contado.
 *
 * Nullable/default constante: los pagos existentes quedan sin marca. Idempotente,
 * con lock_timeout, dry-run por defecto.
 *   node scripts/add-cambio-contado-columns.js [--apply]
 */
require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

const COLS = [
  ['cambioContado', 'BOOLEAN DEFAULT false'],
  ['realizadopor', 'VARCHAR(20)'],
  ['nota', 'TEXT'],
];

(async () => {
  const u = new URL(process.env.DATABASE_URL); u.searchParams.delete('sslmode');
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const hay = new Set((await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='PAGOS_TITULARES'`)).rows.map(r => r.column_name));
    for (const [n] of COLS) console.log(`${n}: ${hay.has(n) ? 'existe' : 'falta'}`);
    if (!process.argv.includes('--apply')) return console.log('(dry-run — usa --apply)');
    await c.query(`SET lock_timeout = '5s'`);
    for (const [n, ddl] of COLS) await c.query(`ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "${n}" ${ddl}`);
    console.log('Columnas listas.');
  } finally { await c.end(); }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
