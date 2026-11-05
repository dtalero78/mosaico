/**
 * add-dos-recibos-column.js
 *
 * Agrega PAGOS_TITULARES."dosRecibos" (BOOLEAN NOT NULL DEFAULT false): marca los
 * pagos registrados con la casilla "El pago tiene dos recibos" del modal Registrar
 * Pago. Con la marca, los dos comprobantes van en documentosAdjuntos (recibo 1 y 2)
 * y el valor del pago se digita a mano (la IA no lo llena).
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS, default constante = solo metadatos).
 *   node scripts/add-dos-recibos-column.js           (dry-run: muestra el SQL)
 *   node scripts/add-dos-recibos-column.js --apply
 */
require('dotenv').config({ path: '.env.local', quiet: true });
const { Client } = require('pg');

const SQL = `ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "dosRecibos" BOOLEAN NOT NULL DEFAULT false`;

(async () => {
  if (!process.argv.includes('--apply')) {
    console.log(SQL);
    console.log('(dry-run — use --apply para ejecutar)');
    return;
  }
  const c = new Client({
    connectionString: (() => { const u = new URL(process.env.DATABASE_URL); u.searchParams.delete('sslmode'); return u.toString(); })(),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query(`SET lock_timeout = '5s'`);
    await c.query(SQL);
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM "PAGOS_TITULARES" WHERE "dosRecibos"`);
    console.log(`✅ PAGOS_TITULARES.dosRecibos lista (${r.rows[0].n} marcados).`);
  } finally {
    await c.end();
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
