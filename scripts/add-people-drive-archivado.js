/**
 * PEOPLE."driveArchivadoEn" (TIMESTAMPTZ): cuándo se archivó el PDF del contrato en el Drive propio
 * (CONTRATOS MOS). Lo escribe la app al subir el PDF; el Libro de Producción lo usa para el motivo
 * "Sin Drive". Idempotente. Ensayo por defecto; --apply para escribir.
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?]sslmode=[a-z-]+/, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  const apply = process.argv.includes('--apply');
  const c = await pool.connect();
  try {
    if (!apply) { console.log('Ensayo: ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "driveArchivadoEn" TIMESTAMPTZ'); return; }
    await c.query(`SET lock_timeout = '5s'`);
    await c.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "driveArchivadoEn" TIMESTAMPTZ`);
    console.log('Columna lista.');
  } finally { c.release(); await pool.end(); }
})();
