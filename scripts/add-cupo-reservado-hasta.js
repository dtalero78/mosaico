/**
 * `PEOPLE.cupoReservadoHasta` — reserva TEMPORAL del cupo mientras se cierra el
 * contrato.
 *
 * Hasta ahora, al crear el contrato el asiento NO quedaba tomado: se reservaba
 * recién al marcar el contrato listo. Entre una cosa y otra, otro comercial podía
 * llevarse el último cupo y el contrato quedaba sin salón.
 *
 * Ahora al crear el contrato el beneficiario recibe una reserva de 60 minutos.
 * Si en ese plazo se marca listo, el cupo pasa a confirmado (`cupoConfirmado`) y
 * la reserva se limpia. Si no, **caduca sola**: la ocupación se calcula AL LEER
 * (`cupoOcupadoSql`), así que basta con que la fecha quede atrás — no hace falta
 * ningún cron ni proceso de limpieza.
 *
 * Idempotente. La columna nace en NULL, así que ningún contrato ya existente
 * queda reservado por accidente.
 *
 * Uso: node scripts/add-cupo-reservado-hasta.js [--apply]
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
      WHERE table_name='PEOPLE' AND column_name='cupoReservadoHasta'`);

  if (tiene.rowCount) {
    console.log('  columna cupoReservadoHasta: ya existe');
  } else if (APPLY) {
    await pool.query(`ALTER TABLE "PEOPLE" ADD COLUMN IF NOT EXISTS "cupoReservadoHasta" TIMESTAMPTZ`);
    // Índice parcial: sólo interesan las reservas vivas, que son unas pocas.
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_people_cupo_reservado"
                        ON "PEOPLE" ("cupoReservadoHasta")
                      WHERE "cupoReservadoHasta" IS NOT NULL`);
    console.log('  columna cupoReservadoHasta: CREADA (+ índice parcial)');
  } else {
    console.log('  columna cupoReservadoHasta: se crearía (TIMESTAMPTZ, nace en NULL)');
  }

  if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); await pool.end(); return; }

  console.table((await pool.query(`
    SELECT COUNT(*) FILTER (WHERE "cupoConfirmado" IS TRUE)::int "cupo confirmado",
           COUNT(*) FILTER (WHERE "cupoReservadoHasta" > NOW())::int "reserva viva",
           COUNT(*) FILTER (WHERE "cupoReservadoHasta" IS NOT NULL AND "cupoReservadoHasta" <= NOW())::int "reserva vencida"
      FROM "PEOPLE" WHERE "tipoUsuario"='BENEFICIARIO'`)).rows);
  console.log('');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
