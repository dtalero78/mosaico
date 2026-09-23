/**
 * Deja constancia de quién autorizó agendar por encima del cupo del evento.
 *
 * Hasta ahora cinco roles se saltaban el límite en silencio y no quedaba rastro:
 * el Welcome del 25-sep terminó en 15 de 13 y en los datos sólo se veía quién
 * agendó, no que supiera que estaba pasándose. Las dos columnas guardan la
 * autorización EN EL AGENDAMIENTO, que es donde ocurre el sobrecupo (un evento
 * puede tener unos dentro del cupo y otros por encima), igual que
 * `PEOPLE.sobrecupoAutorizado*` guarda el del salón.
 *
 * Idempotente (ADD COLUMN IF NOT EXISTS); ensayo por defecto.
 *
 * Uso:
 *   node scripts/add-bookings-sobrecupo.js           (ensayo)
 *   node scripts/add-bookings-sobrecupo.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const COLUMNAS = [
  ['sobrecupoAutorizadoPor', 'VARCHAR(255)'],
  ['sobrecupoAutorizadoEn', 'TIMESTAMPTZ'],
];

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    const existentes = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ACADEMICA_BOOKINGS'`
    )).rows.map((r) => r.column_name);

    const faltan = COLUMNAS.filter(([c]) => !existentes.includes(c));
    if (!faltan.length) { console.log('Las dos columnas ya existen. Nada que hacer.'); return; }

    console.log('Se agregarán a ACADEMICA_BOOKINGS: ' + faltan.map(([c, t]) => c + ' ' + t).join(', '));
    if (!APPLY) { console.log('\nEnsayo. Correr con --apply para aplicarlo.'); return; }

    for (const [col, tipo] of faltan) {
      await client.query(`ALTER TABLE "ACADEMICA_BOOKINGS" ADD COLUMN IF NOT EXISTS "${col}" ${tipo}`);
      console.log('  ✓ ' + col);
    }
    const n = (await client.query(`SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKINGS"`)).rows[0].n;
    console.log(`\n✓ Listo. ${n} agendamiento(s) existentes quedan con las dos columnas en NULL (nadie autorizó nada antes).`);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
