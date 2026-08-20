/**
 * Detecta alumnos con clases FUTURAS agendadas en un salón que ya no es el suyo.
 *
 * Sólo lectura. No borra ni escribe nada.
 *
 * "Huérfano" = agendamiento a un evento de un curso distinto al de la ficha del
 * alumno (campaña + curso + horario) Y que **aún no se ha dictado**. Los PASADOS de
 * otro curso NO son huérfanos: son su historia en la campaña anterior, y
 * "Cambio Académico" los conserva a propósito.
 *
 * Aparecen cuando a un alumno se le cambia el curso SIN pasar por Cambio Académico
 * — por ejemplo editando la ficha desde el visor de BD. Ese flujo borra los futuros
 * del curso viejo; una edición directa no, y el alumno queda en dos salones a la
 * vez (su guía anterior lo sigue viendo en la lista).
 *
 * Uso: node scripts/detectar-agendamientos-huerfanos.js
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const SQL = `
  SELECT b."numeroId",
         TRIM(CONCAT_WS(' ', b."primerNombre", b."primerApellido")) AS alumno,
         b."tipoCurso" || ' · ' || COALESCE(b."salon",'—') || ' · ' || b."horarioCurso"
           || ' (' || b."campaign" || ')' AS "suFicha",
         cc."tipoCurso" || ' · ' || cc."salon" || ' · ' || cc."horarioCurso"
           || ' (' || cc."campaign" || ')' AS "salonAjeno",
         COUNT(*)::int AS futuras,
         COUNT(*) FILTER (WHERE k."asistio" OR k."asistencia" OR k."participacion"
            OR k."noAprobo" OR k."cancelo" OR k."calificacion" IS NOT NULL
            OR COALESCE(k."advisorAnotaciones",'') <> '')::int AS "conHistoria",
         MIN(TO_CHAR(e."dia" AT TIME ZONE 'America/Santiago','YYYY-MM-DD')) AS "primera"
    FROM "ACADEMICA" a
    JOIN "PEOPLE" b ON b."numeroId" = a."numeroId" AND b."tipoUsuario" = 'BENEFICIARIO'
    JOIN "ACADEMICA_BOOKINGS" k ON (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
    JOIN "CALENDARIO" e ON e."_id" = k."eventoId"
    JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
   WHERE COALESCE(b."contrato",'') NOT LIKE 'PRB-%'
     AND COALESCE(b."numeroId",'') <> ''
     AND e."dia" >= NOW()
     AND NOT (cc."campaign" = b."campaign"
          AND cc."tipoCurso" = b."tipoCurso"
          AND cc."horarioCurso" = b."horarioCurso")
   GROUP BY 1,2,3,4
   ORDER BY 5 DESC`;

(async () => {
  const { rows } = await pool.query(SQL);
  if (!rows.length) {
    console.log('\n  ✅ Ningún alumno tiene clases futuras en un salón ajeno.\n');
  } else {
    console.log(`\n  ⚠ ${rows.length} caso(s) — clases FUTURAS en un salón que no es el suyo:\n`);
    console.table(rows);
    console.log('  Se corrigen moviendo al alumno con "Cambio Académico" (borra los futuros');
    console.log('  del salón viejo y crea los del nuevo), o borrando los futuros ajenos si ya');
    console.log('  está en el salón correcto. Los que traigan "conHistoria" > 0 se revisan a mano.\n');
  }

  // Contexto: los PASADOS de otro curso son normales — historia de campañas previas.
  const hist = (await pool.query(`
    SELECT COUNT(*)::int n, COUNT(DISTINCT a."_id")::int alumnos
      FROM "ACADEMICA" a
      JOIN "PEOPLE" b ON b."numeroId" = a."numeroId" AND b."tipoUsuario" = 'BENEFICIARIO'
      JOIN "ACADEMICA_BOOKINGS" k ON (k."idEstudiante" = a."_id" OR k."studentId" = a."_id")
      JOIN "CALENDARIO" e ON e."_id" = k."eventoId"
      JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = e."cursoCampaignId"
     WHERE COALESCE(b."contrato",'') NOT LIKE 'PRB-%' AND e."dia" < NOW()
       AND NOT (cc."campaign" = b."campaign" AND cc."tipoCurso" = b."tipoCurso"
            AND cc."horarioCurso" = b."horarioCurso")`)).rows[0];
  console.log(`  (Contexto: ${hist.n} clases YA DICTADAS de otros cursos en ${hist.alumnos} alumnos.`);
  console.log('   Ésas NO son huérfanas: son su historia de campañas anteriores.)\n');
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
