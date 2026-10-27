/**
 * MOSAICO — Saltos de lección del calendario de un salón.
 *
 * Agrega CURSOS_CAMPAIGN."saltosLeccion" (JSONB, default []): [{desde, modulo, leccion, fecha, por}].
 * Lo escribe el Ajuste masivo hacia adelante; `mapearLeccionesSalon` lo aplica para que desde
 * la sesión `desde` el calendario siga en esa lección. Idempotente; ensayo por defecto.
 *
 * Uso: node scripts/add-cursos-saltos-leccion.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''), ssl: { rejectUnauthorized: false } });
  const ya = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='CURSOS_CAMPAIGN' AND column_name='saltosLeccion'`)).rowCount > 0;
  console.log(ya ? 'Columna saltosLeccion ya existe.' : 'Columna saltosLeccion NO existe → se crea.');
  if (APPLY && !ya) {
    await pool.query(`SET lock_timeout='5s'`);
    await pool.query(`ALTER TABLE "CURSOS_CAMPAIGN" ADD COLUMN IF NOT EXISTS "saltosLeccion" JSONB DEFAULT '[]'::jsonb`);
    console.log('✅ columna creada');
  } else if (!APPLY && !ya) console.log('(ensayo) usa --apply para crearla');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
