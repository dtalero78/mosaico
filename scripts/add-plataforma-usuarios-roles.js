/**
 * Agrega columna `plataforma` a USUARIOS_ROLES.
 *
 * Idempotente — usa ADD COLUMN IF NOT EXISTS.
 * Tipo: VARCHAR(50) — consistente con PEOPLE.plataforma y ACADEMICA.plataforma.
 *
 * NO hace backfill por defecto. Si quieres copiar el valor desde PEOPLE
 * por email, corre con --backfill.
 *
 * Uso:
 *   node scripts/add-plataforma-usuarios-roles.js            → solo agrega columna
 *   node scripts/add-plataforma-usuarios-roles.js --backfill → agrega + copia de PEOPLE
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const BACKFILL = process.argv.includes('--backfill');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    // 1. Verificar si la columna ya existe
    const exists = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'USUARIOS_ROLES' AND column_name = 'plataforma'
    `);
    if (exists.rowCount > 0) {
      console.log('La columna "plataforma" ya existe en USUARIOS_ROLES.');
    } else {
      await pool.query(`ALTER TABLE "USUARIOS_ROLES" ADD COLUMN "plataforma" VARCHAR(50)`);
      console.log('✓ Columna "plataforma" agregada a USUARIOS_ROLES.');
    }

    // 2. Backfill opcional desde PEOPLE
    if (BACKFILL) {
      console.log('\nEjecutando backfill desde PEOPLE.plataforma por email...');
      const upd = await pool.query(`
        UPDATE "USUARIOS_ROLES" u
        SET "plataforma" = p."plataforma", "_updatedDate" = NOW()
        FROM (
          SELECT DISTINCT ON (LOWER("email")) LOWER("email") AS email_lower, "plataforma"
          FROM "PEOPLE"
          WHERE COALESCE("plataforma", '') <> '' AND COALESCE("email", '') <> ''
          ORDER BY LOWER("email"), "_updatedDate" DESC NULLS LAST
        ) p
        WHERE LOWER(u."email") = p.email_lower
          AND (u."plataforma" IS NULL OR u."plataforma" = '')
      `);
      console.log(`✓ ${upd.rowCount} filas actualizadas con plataforma desde PEOPLE.`);
    } else {
      console.log('\n(Sin backfill — los registros quedan con plataforma NULL.)');
      console.log('Para copiar desde PEOPLE por email, corre con --backfill');
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
