/**
 * Agrega a PEOPLE la BITÁCORA del cupo del beneficiario:
 *   "cupoHistory" JSONB DEFAULT '[]'  — una entrada por cada vez que se suelta o
 *                                       se vuelve a tomar el asiento del salón.
 *
 * Por qué una columna nueva y no `suspenddata`: `suspenddata` guarda UN solo
 * evento (se sobrescribe en cada suspensión), así que la segunda inactivación
 * borraría de dónde salió la primera. El cupo hay que poder reconstruirlo hacia
 * atrás, así que va append-only — mismo patrón que `onHoldHistory` y
 * `extensionHistory`, que ya viven en esta tabla.
 *
 * Y por qué hacía falta: hasta ahora **nadie guardaba de qué salón salió el
 * alumno**. "Liberar cupo" calcula ese dato (`cursoBorrado`) y lo devuelve a la
 * pantalla, pero borra las columnas sin dejar rastro; la inactivación ni siquiera
 * las tocaba. Al soltar el asiento se perdía la única referencia de dónde estaba.
 *
 * Forma de cada entrada:
 *   { fecha, accion: 'LIBERADO' | 'ASIGNADO',
 *     origen: 'INACTIVACION' | 'MANUAL' | 'ASIGNACION' | 'REACTIVACION',
 *     tipoSalida: 'REEMPLAZO' | 'TEMPORAL' | null,   // sólo al inactivar
 *     campaign, tipoCurso, horarioCurso, salon,       // de dónde salió / a dónde entró
 *     motivo, realizadoPor, realizadoPorNombre, clasesSoltadas }
 *
 * Todas las filas arrancan en [] — la migración no inventa historia para lo ya
 * ocurrido: de los 8 beneficiarios hoy inactivados con curso asignado no se sabe
 * cuándo se les soltó el asiento, y escribirlo sería fabricar el dato.
 *
 * Uso: node scripts/add-people-cupo-history.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoHistory" JSONB DEFAULT '[]'::jsonb;
UPDATE "PEOPLE" SET "cupoHistory" = '[]'::jsonb WHERE "cupoHistory" IS NULL;
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name = 'cupoHistory'`
  );
  if (pre.length === 1) {
    const { rows: [{ n }] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "PEOPLE" WHERE jsonb_array_length(COALESCE("cupoHistory",'[]'::jsonb)) > 0`
    );
    console.log(`✓ La columna ya existe (${n} beneficiario(s) con movimientos de cupo registrados).`);
    await pool.end();
    return;
  }
  if (!APPLY) {
    console.log('Falta la columna "cupoHistory".\n(dry-run) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply.');
    await pool.end();
    return;
  }
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'PEOPLE' AND column_name = 'cupoHistory'`
  );
  console.log('✅ Columna creada:');
  console.table(rows);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
