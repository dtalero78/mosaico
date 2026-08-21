/**
 * `ADMIN_EVENTS.anfitrionId` — el guía que pone la SALA del evento administrativo.
 *
 * Los eventos administrativos (Training, Support, Meeting…) no tenían enlace: se
 * creaban, aparecían en el calendario del guía y no había por dónde entrar.
 *
 * Se guarda el guía anfitrión, no el enlace: la sala se resuelve AL LEER desde
 * `GUIAS.zoom`, igual que las clases. Así, si ese guía corrige su sala, todos sus
 * eventos administrativos la siguen sin que nadie los actualice — que es
 * exactamente el fallo que dejó a 132 alumnos con un enlace de chat.
 *
 * Idempotente. Nace en NULL: los eventos ya creados siguen sin enlace, como hoy.
 *
 * Uso: node scripts/add-admin-events-anfitrion.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

  const tiene = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='ADMIN_EVENTS' AND column_name='anfitrionId'`);

  if (tiene.rowCount) {
    console.log('  columna anfitrionId: ya existe');
  } else if (APPLY) {
    await pool.query(`ALTER TABLE "ADMIN_EVENTS" ADD COLUMN IF NOT EXISTS "anfitrionId" VARCHAR(255)`);
    console.log('  columna anfitrionId: CREADA');
  } else {
    console.log('  columna anfitrionId: se crearía (VARCHAR(255), nace en NULL)');
  }

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  console.table((await pool.query(`
    SELECT COUNT(*)::int "eventos administrativos",
           COUNT(*) FILTER (WHERE "anfitrionId" IS NOT NULL)::int "con anfitrión",
           COUNT(*) FILTER (WHERE "fechaInicio" >= NOW())::int "futuros"
      FROM "ADMIN_EVENTS"`)).rows);
  console.log('');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
