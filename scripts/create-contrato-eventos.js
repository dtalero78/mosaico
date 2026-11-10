/**
 * Crea CONTRATO_EVENTOS: bitácora (solo INSERT) de los movimientos de un contrato que
 * no quedaban escritos en ningún otro lado (documento subido/borrado, edición del
 * contrato, envío del PDF, beneficiario agregado/eliminado, apoderado, gestor de
 * recaudo, inactivación, cambio de step…). El Seguimiento del contrato
 * (src/services/seguimiento-contrato.service.ts) la fusiona al leer con las demás
 * fuentes (APROBACION_AUDIT, PAGOS_TITULARES, historiales JSONB…).
 *
 * Uso: node scripts/create-contrato-eventos.js            (dry-run)
 *      node scripts/create-contrato-eventos.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const SQL = [
  `CREATE TABLE IF NOT EXISTS "CONTRATO_EVENTOS" (
     "_id"           VARCHAR(64) PRIMARY KEY,
     "titularId"     VARCHAR(64),
     "contrato"      VARCHAR(64),
     "personaId"     VARCHAR(64),
     "personaNombre" TEXT,
     "tipoUsuario"   VARCHAR(20),
     "categoria"     VARCHAR(30) NOT NULL,
     "accion"        VARCHAR(60) NOT NULL,
     "detalle"       TEXT,
     "datos"         JSONB,
     "usuarioEmail"  VARCHAR(255),
     "usuarioNombre" VARCHAR(255),
     "usuarioRol"    VARCHAR(60),
     "_createdDate"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_contrato_eventos_contrato ON "CONTRATO_EVENTOS" ("contrato", "_createdDate")`,
  `CREATE INDEX IF NOT EXISTS idx_contrato_eventos_titular ON "CONTRATO_EVENTOS" ("titularId", "_createdDate")`,
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ex = await c.query(`SELECT to_regclass('public."CONTRATO_EVENTOS"') AS t`);
  console.log(`CONTRATO_EVENTOS ${ex.rows[0].t ? 'ya existe' : 'no existe'}`);
  if (!APPLY) {
    SQL.forEach(s => console.log('\n' + s));
    console.log('\nDry-run. Use --apply para crear.');
    await c.end();
    return;
  }
  await c.query('BEGIN');
  try {
    for (const s of SQL) await c.query(s);
    await c.query('COMMIT');
    console.log('✅ CONTRATO_EVENTOS lista');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  await c.end();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
