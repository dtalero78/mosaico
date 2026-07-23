/**
 * Tabla-marcador `_BASE_MOSAICO`: identifica a simple vista QUÉ base de datos
 * estás viendo en Prisma Studio / cualquier visor. Por el guion bajo + mayúsculas
 * aparece de PRIMERA en la lista de tablas. Una sola fila descriptiva.
 * (En LGS crear `_BASE_LGS` y en LGSKIDS `_BASE_LGSKIDS` con el mismo patrón.)
 * Idempotente. Uso: node scripts/create-base-marker-table.js
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS "_BASE_MOSAICO" (
    "plataforma"  TEXT PRIMARY KEY,
    "descripcion" TEXT,
    "dominio"     TEXT,
    "cluster"     TEXT,
    "advertencia" TEXT
  )`);
  await pool.query(`INSERT INTO "_BASE_MOSAICO" ("plataforma","descripcion","dominio","cluster","advertencia")
    VALUES ('MOSAICO','Base de datos de PRODUCCIÓN de MOSAICO (soroban)','mosaicosorobanplataforma.com','mosaico-db (DO nyc3)','⚠ PRODUCCIÓN — editar con cuidado')
    ON CONFLICT ("plataforma") DO NOTHING`);
  console.log('✓ _BASE_MOSAICO creada/verificada');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
