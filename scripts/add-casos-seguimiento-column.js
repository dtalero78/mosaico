/**
 * Agrega CASOS_ATENCION."seguimiento" (JSONB, append-only).
 *
 * La bitácora de un caso ya se escribía repartida en tres tablas: el reporte del
 * guía en CASOS_REPORTES, cada asignación y cierre en CASOS_ESTADO_HISTORIAL, y
 * los intentos en CASOS_CONTACTOS. Lo único que NO tenía dónde vivir es la nota
 * suelta —"llamé, quedó de responder mañana"—, un movimiento que no cambia el
 * estado del caso. Esta columna guarda SÓLO eso.
 *
 * Se eligió una columna y no otra tabla porque son notas del propio caso, se
 * leen siempre junto a él y nunca se consultan por su cuenta. La pantalla
 * muestra la FUSIÓN de las cuatro fuentes ordenada por fecha: copiar aquí el
 * reporte o la asignación habría dejado dos verdades del mismo hecho.
 *
 * Forma: [{ fecha, texto, autorEmail, autorNombre }]
 *
 * Idempotente. Uso: node scripts/add-casos-seguimiento-column.js [--apply]
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const DDL = [
  `ALTER TABLE "CASOS_ATENCION"
     ADD COLUMN IF NOT EXISTS "seguimiento" JSONB NOT NULL DEFAULT '[]'::jsonb`,
];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows: antes } = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'CASOS_ATENCION' AND column_name = 'seguimiento'`
    );
    const { rows: [n] } = await pool.query(`SELECT COUNT(*)::int AS casos FROM "CASOS_ATENCION"`);

    console.log(`Casos en la tabla: ${n.casos}`);
    console.log(antes.length
      ? `La columna "seguimiento" YA existe (${antes[0].data_type}) — nada que hacer.`
      : `La columna "seguimiento" NO existe todavía.`);

    if (!APPLY) {
      console.log('\n[ENSAYO] Se ejecutaría:');
      DDL.forEach(s => console.log('  ' + s.replace(/\s+/g, ' ').trim()));
      console.log('\nVuelve a correr con --apply para aplicarlo.');
      return;
    }

    for (const sql of DDL) {
      await pool.query(sql);
      console.log('OK: ' + sql.replace(/\s+/g, ' ').trim());
    }

    const { rows: despues } = await pool.query(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
        WHERE table_name = 'CASOS_ATENCION' AND column_name = 'seguimiento'`
    );
    console.table(despues);
    console.log('Listo. Todos los casos existentes quedan con la bitácora vacía.');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
