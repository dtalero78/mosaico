/**
 * Agrega REPORTE_ACADEMICO_NOTAS."criterios" (JSONB) para guardar los 8 criterios
 * que el Guía marca A MANO en el Reporte Académico (Puntual, Asignación, Dominio,
 * Participó, Desafío, Activo, Respeto, Cámara).
 *
 * Por qué: antes los 9 óvalos se derivaban de ACADEMICA_BOOKINGS (hePuntualidad,
 * heAsignacion, daDominio, participacion, daDesafio, acPermanencia, acRespeto,
 * acDisposicion), pero esos criterios se retiraron del panel de /sesion/[id], así
 * que ya no tienen quien los alimente. Ahora se capturan en el propio reporte y se
 * guardan por (academicaId, salon, semanaInicio) — la misma llave que ya usan
 * comentarioIA y notaGuia. "Asistió" NO entra aquí: se sigue calculando solo, a
 * partir de la asistencia marcada en cada sesión.
 *
 * Formato: {"puntual":"full","asignacion":"half","dominio":"empty", …}
 *   full  = cumplió todas | half = cumplió algunas | empty = no cumplió
 *   clave ausente = sin marcar (el óvalo sale vacío/punteado)
 * Se usa un JSONB en vez de 8 columnas para que agregar o quitar criterios no
 * exija otra migración: la lista vive en METRICAS del service.
 *
 * Uso: node scripts/add-reporte-academico-criterios.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const { rows: pre } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'REPORTE_ACADEMICO_NOTAS' AND column_name = 'criterios'`
  );
  if (pre.length) {
    console.log('✓ La columna "criterios" ya existe — nada que hacer.');
    await pool.end();
    return;
  }

  const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "REPORTE_ACADEMICO_NOTAS"`);
  console.log(`REPORTE_ACADEMICO_NOTAS tiene ${n} fila(s). Falta la columna "criterios".`);

  if (!APPLY) {
    console.log('\n(dry-run) Se ejecutaría:');
    console.log(`  ALTER TABLE "REPORTE_ACADEMICO_NOTAS"\n    ADD COLUMN IF NOT EXISTS "criterios" JSONB DEFAULT '{}'::jsonb;`);
    console.log('\nReejecuta con --apply para aplicarlo.');
    await pool.end();
    return;
  }

  await pool.query(
    `ALTER TABLE "REPORTE_ACADEMICO_NOTAS"
       ADD COLUMN IF NOT EXISTS "criterios" JSONB DEFAULT '{}'::jsonb`
  );
  // Las filas existentes quedan con '{}' (sin marcar), que es justo lo pedido:
  // los criterios arrancan en blanco y el Guía los llena.
  await pool.query(`UPDATE "REPORTE_ACADEMICO_NOTAS" SET "criterios" = '{}'::jsonb WHERE "criterios" IS NULL`);

  const { rows: post } = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'REPORTE_ACADEMICO_NOTAS' AND column_name = 'criterios'`
  );
  console.log('✅ Columna creada:');
  console.table(post);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
