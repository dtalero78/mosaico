/**
 * backfill-welcome-events-tipo.js
 * En MOSAICO WELCOME es un CURSO (no un tipo). Los eventos con curso='WELCOME'
 * deben tener tipo/evento='WELCOME' (se muestran en morado) y el nombre de
 * display en formato "Curso - Módulo - Lección" (ej. "WELCOME - MOSAICO - Leccion 00").
 * Este script normaliza los eventos WELCOME creados antes con tipo=SESSION.
 * Uso: node scripts/backfill-welcome-events-tipo.js [--apply]   (sin --apply → dry-run). Idempotente.
 */
require('dotenv').config({ path: '.env.local' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
const cs = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, '');
const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

(async () => {
  const sel = await pool.query(
    `SELECT "_id","tipo","nivel","step","tituloONivel" FROM "CALENDARIO"
     WHERE "curso"='WELCOME' AND (COALESCE("tipo",'')<>'WELCOME' OR "tituloONivel" NOT LIKE 'WELCOME -%')`);
  console.log(`Eventos WELCOME a normalizar: ${sel.rowCount}`);
  sel.rows.forEach(x => console.log('  ', JSON.stringify(x)));
  if (!APPLY) { console.log('DRY-RUN. Ejecuta con --apply.'); await pool.end(); return; }
  const r = await pool.query(
    `UPDATE "CALENDARIO"
       SET "tipo"='WELCOME', "evento"='WELCOME',
           "tituloONivel" = 'WELCOME - ' || COALESCE("nivel",'') || CASE WHEN COALESCE("step",'')<>'' THEN ' - ' || "step" ELSE '' END,
           "titulo" = 'WELCOME - ' || COALESCE("nivel",'') || CASE WHEN COALESCE("step",'')<>'' THEN ' - ' || "step" ELSE '' END,
           "_updatedDate"=NOW()
     WHERE "curso"='WELCOME' AND (COALESCE("tipo",'')<>'WELCOME' OR "tituloONivel" NOT LIKE 'WELCOME -%')
     RETURNING "_id","tipo","tituloONivel"`);
  console.log(`✅ Actualizados: ${r.rowCount}`);
  r.rows.forEach(x => console.log('  ', JSON.stringify(x)));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
