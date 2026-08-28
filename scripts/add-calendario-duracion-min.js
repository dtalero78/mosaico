/**
 * Agrega CALENDARIO."duracionMin" (INTEGER, nullable).
 *
 * Duración del evento EN MINUTOS, cuando no se deriva de su tipo ni del horario
 * del curso. Existe porque una nivelación dura 30 minutos por defecto pero puede
 * ampliarse a una hora: eso es una decisión de quien la agenda, no una propiedad
 * del tipo, así que no se puede seguir derivando.
 *
 * NULL = derivar como siempre (`src/lib/event-duration.ts`: horario del curso si
 * es legible, si no el tipo). Por eso la columna es nullable y no se rellena:
 * los 26.000+ eventos existentes conservan exactamente la duración que ya tenían.
 *
 * Uso:
 *   node scripts/add-calendario-duracion-min.js            # sólo informa
 *   node scripts/add-calendario-duracion-min.js --apply    # aplica
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

(async () => {
  const cs = String(process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, '');
  if (!cs) { console.error('Falta DATABASE_URL'); process.exit(1); }
  const pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false } });

  const existe = async () => (await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'CALENDARIO' AND column_name = 'duracionMin'`
  )).rowCount > 0;

  if (await existe()) {
    const n = (await pool.query(`SELECT COUNT(*)::int c FROM "CALENDARIO" WHERE "duracionMin" IS NOT NULL`)).rows[0].c;
    console.log(`La columna ya existe. Eventos con duración propia: ${n}`);
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('La columna NO existe. Se agregaría:');
    console.log('  ALTER TABLE "CALENDARIO" ADD COLUMN "duracionMin" INTEGER');
    console.log('Ningún evento cambia de duración (NULL = se sigue derivando).');
    console.log('Corre con --apply para aplicarlo.');
    await pool.end();
    return;
  }

  await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "duracionMin" INTEGER`);
  console.log(await existe() ? 'Columna agregada.' : 'No se pudo agregar.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
