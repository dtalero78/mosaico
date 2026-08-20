/**
 * Borra los agendamientos HUÉRFANOS: clases FUTURAS de un alumno en un curso que
 * ya no es el suyo. Complemento de `detectar-agendamientos-huerfanos.js`.
 *
 * Las clases YA DICTADAS de otro curso NO se tocan: son su historia en la campaña
 * anterior, y "Cambio Académico" las conserva a propósito. Borrarlas destruiría su
 * hoja de asistencia.
 *
 * Tampoco se borra ninguna que traiga registro — asistencia, participación,
 * no-aprobó, cancelación, calificación o anotaciones del guía: eso es historia que
 * no se puede reconstruir, y se reporta para revisarla a mano.
 *
 * Al borrar se ajusta el contador `inscritos` del evento, para que la lista del
 * guía y los conteos cuadren.
 *
 * Uso: node scripts/limpiar-agendamientos-huerfanos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

// Un alumno se une a su ficha por `peopleId`; el `numeroId` es sólo el respaldo
// para las fichas viejas que no lo tienen (y hay beneficiarios SIN documento, así
// que unir sólo por numeroId los deja fuera y esconde casos).
const HUERFANOS = `
  SELECT k."_id",
         k."eventoId",
         TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) AS alumno,
         cc."tipoCurso" || ' · ' || cc."salon" AS ajeno,
         b."tipoCurso" || ' · ' || COALESCE(b."salon",'—') AS suyo,
         (k."asistio" OR k."asistencia" OR k."participacion" OR k."noAprobo" OR k."cancelo"
          OR k."calificacion" IS NOT NULL OR COALESCE(k."advisorAnotaciones",'') <> ''
          OR COALESCE(k."comentarios",'') <> '') AS "tieneHistoria"
    FROM "ACADEMICA" a
    JOIN "PEOPLE" b ON (a."peopleId" = b."_id"
                     OR (COALESCE(a."peopleId",'') = '' AND COALESCE(a."numeroId",'') <> ''
                         AND b."numeroId" = a."numeroId"))
                   AND b."tipoUsuario" = 'BENEFICIARIO'
    JOIN "ACADEMICA_BOOKINGS" k ON (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
    JOIN "CALENDARIO" e ON e."_id" = k."eventoId"
    JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
   WHERE COALESCE(b."contrato",'') NOT LIKE 'PRB-%'
     AND e."dia" >= NOW()
     AND NOT (cc."campaign" = b."campaign"
          AND cc."tipoCurso" = b."tipoCurso"
          AND cc."horarioCurso" = b."horarioCurso")`;

(async () => {
  const c = await pool.connect();
  try {
    console.log(APPLY ? '\n=== APLICANDO ===\n' : '\n=== DRY-RUN (usa --apply) ===\n');

    const filas = (await c.query(HUERFANOS)).rows;
    if (!filas.length) { console.log('  ✅ No hay huérfanos.\n'); return; }

    const resumen = new Map();
    for (const f of filas) {
      const k = `${f.alumno} | ${f.suyo} ← sobra: ${f.ajeno}`;
      const v = resumen.get(k) || { borra: 0, conservan: 0 };
      f.tieneHistoria ? v.conservan++ : v.borra++;
      resumen.set(k, v);
    }
    console.table([...resumen].map(([caso, v]) => ({ caso, 'a borrar': v.borra, 'con historia (se conservan)': v.conservan })));

    const borrables = filas.filter(f => !f.tieneHistoria);
    const conHistoria = filas.length - borrables.length;
    console.log(`\n  total: ${filas.length} · se borran ${borrables.length} · se conservan ${conHistoria} por tener registro`);

    if (!APPLY) { console.log('\n  (dry-run: no se escribió nada)\n'); return; }

    await c.query('BEGIN');
    await c.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "_id" = ANY($1::text[])`,
      [borrables.map(f => f._id)]);
    await c.query(
      `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(0, COALESCE("inscritos",0) - 1), "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[])`, [borrables.map(f => f.eventoId)]);
    await c.query('COMMIT');

    console.log(`\n  borrados: ${borrables.length}`);
    const quedan = (await c.query(HUERFANOS)).rows.length;
    console.log(`  huérfanos restantes: ${quedan}${quedan ? ' (los que traen historia)' : ' ✅'}\n`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
