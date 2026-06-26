/**
 * MOSAICO — elimina la FK ACADEMICA_BOOKINGS_studentId_fkey (artefacto del seed).
 *
 * En el motor (LGS) los bookings usan `studentId` = ACADEMICA._id (no PEOPLE._id),
 * por eso la FK studentId -> PEOPLE(_id) que trajo el schema.sql semilla es
 * incorrecta y rompe la generación de bookings precargados en la aprobación.
 *
 * Uso: node scripts/drop-bookings-studentid-fk.js
 * Idempotente: DROP CONSTRAINT IF EXISTS.
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
    await pool.query(`ALTER TABLE "ACADEMICA_BOOKINGS" DROP CONSTRAINT IF EXISTS "ACADEMICA_BOOKINGS_studentId_fkey"`);
    console.log('  ✓ FK ACADEMICA_BOOKINGS_studentId_fkey eliminada (si existía)');
    const r = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='"ACADEMICA_BOOKINGS"'::regclass AND contype='f'`);
    console.log('✅ FKs restantes en ACADEMICA_BOOKINGS:', r.rows.map(x => x.conname).join(', ') || '(ninguna)');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
