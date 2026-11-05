#!/usr/bin/env node
/**
 * add-banco-pagos-titulares.js — Agrega PAGOS_TITULARES.banco (VARCHAR 80).
 *
 * Banco desde el que se hizo el pago (se captura en Registrar Pago o lo lee la IA
 * del comprobante). Nullable: los pagos existentes quedan en NULL. Idempotente,
 * dry-run por defecto, con lock_timeout para no encolar producción.
 *
 * USO:  node scripts/add-banco-pagos-titulares.js [--apply]
 */
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

(async () => {
  const u = new URL(process.env.DATABASE_URL);
  u.searchParams.delete('sslmode');
  const c = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    const existe = (await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='PAGOS_TITULARES' AND column_name='banco' LIMIT 1`)).rowCount > 0;
    console.log(`PAGOS_TITULARES.banco: ${existe ? 'existe' : 'falta'} (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
    if (!APPLY) return console.log('[dry-run] usa --apply.');
    await c.query(`SET lock_timeout = '5s'`);
    await c.query(`ALTER TABLE "PAGOS_TITULARES" ADD COLUMN IF NOT EXISTS "banco" VARCHAR(80)`);
    console.log('Columna banco lista.');
  } catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
  finally { try { await c.end(); } catch {} }
})();
