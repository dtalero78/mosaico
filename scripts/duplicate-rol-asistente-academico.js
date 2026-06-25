/**
 * MOSAICO — duplica el rol COORDINADOR_ACADEMICO en ROL_PERMISOS como
 * ASISTENTE_ACADEMICO (copia exacta de permisos). El admin ajusta los permisos después.
 *
 * Idempotente: si ASISTENTE_ACADEMICO ya existe, no hace nada.
 * Uso: node scripts/duplicate-rol-asistente-academico.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const SRC = 'COORDINADOR_ACADEMICO';
const NEW = 'ASISTENTE_ACADEMICO';

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    const exists = (await pool.query('SELECT 1 FROM "ROL_PERMISOS" WHERE rol = $1', [NEW])).rows.length;
    if (exists > 0) {
      console.log(`• ${NEW} ya existe — no se duplica.`);
      return;
    }
    const src = (await pool.query('SELECT 1 FROM "ROL_PERMISOS" WHERE rol = $1', [SRC])).rows.length;
    if (src === 0) {
      console.log(`✗ No existe el rol origen ${SRC}.`);
      return;
    }
    const id = 'rol_' + randomUUID();
    await pool.query(
      `INSERT INTO "ROL_PERMISOS"
         ("_id","rol","descripcion","permisos","activo","fechaCreacion","fechaActualizacion","_createdDate","_updatedDate","origen")
       SELECT $1, $2, $3, "permisos", true, NOW(), NOW(), NOW(), NOW(), 'ADMIN'
       FROM "ROL_PERMISOS" WHERE rol = $4`,
      [id, NEW, `Rol ${NEW}`, SRC]
    );
    const r = (await pool.query(
      'SELECT rol, descripcion, activo, jsonb_array_length(permisos) AS n FROM "ROL_PERMISOS" WHERE rol = $1',
      [NEW]
    )).rows[0];
    console.log(`✅ Creado ${r.rol} | descripcion="${r.descripcion}" | activo=${r.activo} | #permisos=${r.n} (copiados de ${SRC})`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
