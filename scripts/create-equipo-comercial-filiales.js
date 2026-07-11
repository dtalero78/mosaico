/**
 * MOSAICO — tablas para "Crear Comercial" del nuevo hub Crear Usuarios.
 *
 *  - EQUIPO_COMERCIAL: personas del equipo comercial (Nombre, correo, plataforma,
 *    filial, clave) + enlace a su login en USUARIOS_ROLES (usuarioRolId).
 *  - FILIALES: catálogo gestionable de filiales por plataforma (agregar/suprimir);
 *    alimenta el dropdown "filial" del alta de comercial.
 *
 * Idempotente (CREATE TABLE IF NOT EXISTS). Uso: node scripts/create-equipo-comercial-filiales.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "FILIALES" (
        "_id"          TEXT PRIMARY KEY,
        "plataforma"   VARCHAR(50) NOT NULL,
        "nombre"       VARCHAR(120) NOT NULL,
        "activo"       BOOLEAN DEFAULT true,
        "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
        "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_filiales_plat_nombre ON "FILIALES" (LOWER("plataforma"), LOWER("nombre"))`);
    console.log('  ✓ FILIALES lista');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "EQUIPO_COMERCIAL" (
        "_id"          TEXT PRIMARY KEY,
        "nombre"       VARCHAR(200) NOT NULL,
        "correo"       VARCHAR(200) NOT NULL,
        "plataforma"   VARCHAR(50),
        "filial"       VARCHAR(120),
        "clave"        TEXT,
        "rol"          VARCHAR(30) DEFAULT 'COMERCIAL',
        "usuarioRolId" TEXT,
        "activo"       BOOLEAN DEFAULT true,
        "origen"       VARCHAR(20) DEFAULT 'ADMIN',
        "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
        "_updatedDate" TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_equipo_comercial_correo ON "EQUIPO_COMERCIAL" (LOWER("correo"))`);
    console.log('  ✓ EQUIPO_COMERCIAL lista');

    console.log('✅ Tablas creadas (EQUIPO_COMERCIAL + FILIALES).');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
