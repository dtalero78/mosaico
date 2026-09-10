/**
 * Crea ROL_CAMBIOS_AUDIT: la bitácora de cambios de rol de una cuenta.
 *
 * Cambiar el rol de un usuario cambia lo que esa persona puede ver y hacer en
 * toda la plataforma, así que no puede ser un UPDATE silencioso: queda quién lo
 * hizo, a quién, de qué rol a cuál, por qué y desde dónde.
 *
 * Es append-only —sólo INSERT, nunca UPDATE ni DELETE— igual que PURGE_LOG y
 * ADVISOR_NOTES_AUDIT: una bitácora que se puede editar no sirve como bitácora.
 *
 * Idempotente (CREATE TABLE IF NOT EXISTS).
 *
 * Uso:
 *   node scripts/create-rol-cambios-audit-table.js           (ensayo)
 *   node scripts/create-rol-cambios-audit-table.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const DDL = [
  `CREATE TABLE IF NOT EXISTS "ROL_CAMBIOS_AUDIT" (
     "_id"                TEXT PRIMARY KEY,
     "usuarioRolId"       TEXT NOT NULL,
     "usuarioEmail"       TEXT,
     "usuarioNombre"      TEXT,
     "rolAnterior"        VARCHAR(60),
     "rolNuevo"           VARCHAR(60) NOT NULL,
     "motivo"             TEXT NOT NULL,
     "realizadoPor"       TEXT NOT NULL,
     "realizadoPorNombre" TEXT,
     "ip"                 VARCHAR(45),
     "_createdDate"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_rol_cambios_usuario"
     ON "ROL_CAMBIOS_AUDIT" ("usuarioRolId", "_createdDate" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_rol_cambios_fecha"
     ON "ROL_CAMBIOS_AUDIT" ("_createdDate" DESC)`,
];

(async () => {
  const pool = new Pool({
    connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const existe = (await pool.query(
      `SELECT to_regclass('public."ROL_CAMBIOS_AUDIT"') IS NOT NULL AS e`
    )).rows[0].e;
    console.log(existe ? 'La tabla YA existe.' : 'La tabla NO existe: se creará.');

    if (!APPLY) {
      console.log('\n--- ENSAYO (sin --apply no se escribe nada) ---');
      DDL.forEach(d => console.log('  ' + d.split('\n')[0].trim() + ' …'));
      return;
    }
    for (const d of DDL) await pool.query(d);
    const n = (await pool.query(`SELECT COUNT(*)::int n FROM "ROL_CAMBIOS_AUDIT"`)).rows[0].n;
    console.log(`\n✓ Lista. Registros actuales: ${n}.`);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('✗', e.message); process.exit(1); });
