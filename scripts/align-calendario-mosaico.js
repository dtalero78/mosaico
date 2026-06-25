/**
 * MOSAICO — alinea la tabla CALENDARIO (esquema mínimo del seed) con las columnas
 * que el código del calendario (heredado de LGS) lee/escribe, y agrega el enlace
 * al curso de campaña que generó el evento.
 *
 * Aditivo (ADD COLUMN IF NOT EXISTS). CALENDARIO está vacía en mosaico-db → cero
 * riesgo de datos. NO toca LGS (otra BD).
 *
 *   dia                TIMESTAMPTZ  — instante real del evento (anclado a hora Chile;
 *                                     el front lo renderiza en la hora local del cliente)
 *   evento             VARCHAR(50)  — duplicado legacy de "tipo" (COALESCE en queries)
 *   nombreEvento       TEXT         — para cursos de campaña = el horario
 *   tituloONivel       TEXT         — título mostrado = "Campaña - Curso - Salón"
 *   eventoCompartidoId UUID         — grupos compartidos (nullable, no usado aquí)
 *   cursoCampaignId    VARCHAR(255) — FK lógica a CURSOS_CAMPAIGN._id (idempotencia)
 *
 * Uso: node scripts/align-calendario-mosaico.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const COLUMNS = [
  ['dia', 'TIMESTAMPTZ'],
  ['evento', 'VARCHAR(50)'],
  ['nombreEvento', 'TEXT'],
  ['tituloONivel', 'TEXT'],
  ['eventoCompartidoId', 'UUID'],
  ['cursoCampaignId', 'VARCHAR(255)'],
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const [col, type] of COLUMNS) {
      await pool.query(`ALTER TABLE "CALENDARIO" ADD COLUMN IF NOT EXISTS "${col}" ${type}`);
      console.log(`  ✓ CALENDARIO."${col}" ${type}`);
    }
    // Índices útiles para las consultas del calendario.
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_calendario_dia" ON "CALENDARIO" ("dia")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_calendario_curso" ON "CALENDARIO" ("cursoCampaignId") WHERE "cursoCampaignId" IS NOT NULL`);
    console.log('  ✓ índices dia / cursoCampaignId');
    const c = await pool.query(`SELECT COUNT(*)::int n FROM "CALENDARIO"`);
    console.log(`✅ CALENDARIO alineada. Filas actuales: ${c.rows[0].n}`);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
