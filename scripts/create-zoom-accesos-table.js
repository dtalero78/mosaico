/**
 * Crea ZOOM_ACCESOS: quién generó el acceso a Zoom desde el panel, y cuándo.
 *
 * Una fila POR CLIC — es una bitácora, no un estado: si el alumno vuelve a entrar
 * porque se le cayó la conexión, queda otra fila. Así se ve cuántas veces entró y
 * a qué hora, que es lo que sirve para contrastar contra el reporte de asistentes
 * de Zoom más adelante.
 *
 * Vive en tabla aparte y NO como columna de `ACADEMICA_BOOKINGS` por dos razones:
 *   - Regenerar un curso BORRA y recrea sus agendamientos; una columna se perdería
 *     salvo que se sumara al estado preservado, y esto no es estado de evaluación.
 *   - `bookingConRegistroSql` decide qué agendamiento "tiene registro" y protege
 *     borrados: un clic en el ícono no debería bloquear el borrado de un evento.
 *
 * La llave estable es `(academicaId, fechaEvento)` — el INSTANTE de la clase, que
 * sobrevive a una regeneración; `eventoId` se guarda igual porque es lo que se
 * consulta primero y un alumno no puede tener dos clases en el mismo instante.
 *
 * Uso: node scripts/create-zoom-accesos-table.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const DDL = `
CREATE TABLE IF NOT EXISTS "ZOOM_ACCESOS" (
  "_id"              TEXT PRIMARY KEY,
  "academicaId"      TEXT NOT NULL,
  "numeroId"         TEXT,
  "nombre"           TEXT,
  "bookingId"        TEXT,
  "eventoId"         TEXT,
  "fechaEvento"      TIMESTAMPTZ NOT NULL,
  "cursoCampaignId"  TEXT,
  "curso"            TEXT,
  "salon"            TEXT,
  "tipo"             TEXT,
  "minutosDesdeInicio" INTEGER,
  "ip"               TEXT,
  "userAgent"        TEXT,
  "_createdDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_zoom_accesos_alumno_fecha"
  ON "ZOOM_ACCESOS" ("academicaId", "fechaEvento");
CREATE INDEX IF NOT EXISTS "idx_zoom_accesos_evento"
  ON "ZOOM_ACCESOS" ("eventoId");
CREATE INDEX IF NOT EXISTS "idx_zoom_accesos_fecha"
  ON "ZOOM_ACCESOS" ("_createdDate" DESC);
`;

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT to_regclass('"ZOOM_ACCESOS"') IS NOT NULL AS existe`
  );
  if (pre[0].existe) {
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "ZOOM_ACCESOS"`);
    console.log(`✓ La tabla ya existe (${n} fila(s)) — nada que hacer.`);
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('(dry-run) Se ejecutaría:\n');
    console.log(DDL);
    console.log('Reejecuta con --apply para crearla.');
    await pool.end();
    return;
  }

  await pool.query(DDL);
  const { rows: [{ c }] } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM information_schema.columns WHERE table_name = 'ZOOM_ACCESOS'`
  );
  console.log(`✓ ZOOM_ACCESOS creada (${c} columnas).`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
