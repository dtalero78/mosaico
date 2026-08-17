/**
 * Borra los agendamientos HUÉRFANOS: los que apuntan a un evento de CALENDARIO
 * que ya no existe.
 *
 * Los deja `generarEventosCurso`, que BORRA y recrea las filas de CALENDARIO —
 * los bookings quedan colgando de ids muertos. Se llamaba así desde el PATCH de
 * Campañas, así que **editar un curso destruía los agendamientos de sus
 * alumnos** (AGOSTO172026M · YOJI 01 y DANSHI 03, agosto-2026: el guía abría su
 * sesión y veía "0 estudiantes" con el salón lleno). El PATCH ya usa
 * `regenerarCursoPreservandoEstado`; esto limpia lo que quedó.
 *
 * ⚠ SOLO borra los huérfanos SIN NADA REGISTRADO: si alguno tuviera asistencia,
 * participación, cancelación, calificación o anotaciones, se conserva y se
 * reporta — es historia que no se puede reconstruir, y habría que reengancharla
 * a mano en vez de tirarla.
 *
 * No repone nada: para que los alumnos vuelvan a tener sus clases hay que
 * regenerar el curso (Académico › Campañas, o POST /api/admin/regenerar-curso),
 * que ahora preserva el estado.
 *
 * Uso: node scripts/limpiar-bookings-huerfanos.js [--apply]
 */
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});

const HUERFANO = `NOT EXISTS (SELECT 1 FROM "CALENDARIO" c WHERE c."_id" = b."eventoId" OR c."_id" = b."idEvento")`;
const CON_REGISTRO = `(b."asistio" IS TRUE OR b."asistencia" IS TRUE OR b."participacion" IS TRUE
   OR b."noAprobo" IS TRUE OR b."cancelo" IS TRUE OR b."calificacion" IS NOT NULL
   OR COALESCE(b."advisorAnotaciones", '') <> '' OR COALESCE(b."comentarios", '') <> '')`;

(async () => {
  const { rows: [r] } = await pool.query(`
    SELECT COUNT(*)::int AS huerfanos,
           COUNT(*) FILTER (WHERE ${CON_REGISTRO})::int AS con_registro,
           COUNT(DISTINCT b."idEstudiante")::int AS alumnos
      FROM "ACADEMICA_BOOKINGS" b WHERE ${HUERFANO}`);

  const aBorrar = r.huerfanos - r.con_registro;
  console.log(`Agendamientos huérfanos: ${r.huerfanos}  (${r.alumnos} alumnos)`);
  console.log(`  se BORRAN (sin nada registrado): ${aBorrar}`);
  console.log(`  se CONSERVAN (tienen registro) : ${r.con_registro}`);

  if (r.con_registro > 0) {
    const { rows: det } = await pool.query(`
      SELECT b."_id", b."idEstudiante", b."fechaEvento"::text, b."asistio", b."cancelo", b."calificacion"
        FROM "ACADEMICA_BOOKINGS" b WHERE ${HUERFANO} AND ${CON_REGISTRO} LIMIT 20`);
    console.log('\n⚠ Huérfanos CON registro (quedan para revisión manual):');
    console.table(det);
  }

  console.log('\nCursos activos que quedarán sin agendamientos hasta regenerarlos:');
  const { rows: rotos } = await pool.query(`
    SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon", cc."horarioCurso",
           (SELECT COUNT(*)::int FROM "PEOPLE" pe WHERE pe."tipoUsuario"='BENEFICIARIO'
              AND pe."campaign"=cc."campaign" AND pe."tipoCurso"=cc."tipoCurso"
              AND pe."horarioCurso"=cc."horarioCurso" AND pe."cupoConfirmado" IS TRUE) AS alumnos
      FROM "CURSOS_CAMPAIGN" cc WHERE cc."activa"=true
       AND NOT EXISTS (SELECT 1 FROM "ACADEMICA_BOOKINGS" b
                        WHERE b."eventoId" IN (SELECT "_id" FROM "CALENDARIO" WHERE "cursoCampaignId"=cc."_id"))`);
  const conAlumnos = rotos.filter(x => x.alumnos > 0);
  console.table(conAlumnos.map(x => ({ campaña: x.campaign, curso: x.tipoCurso, salon: x.salon, alumnos: x.alumnos, id: x._id })));
  if (conAlumnos.length) {
    console.log('→ Regenerarlos con:  POST /api/admin/regenerar-curso  { "cursoIds": [' +
      conAlumnos.map(x => `"${x._id}"`).join(', ') + '] }');
  }

  if (!APPLY) {
    console.log('\n(dry-run — nada se borró. Volvé a correr con --apply)');
    await pool.end();
    return;
  }

  const del = await pool.query(
    `DELETE FROM "ACADEMICA_BOOKINGS" b WHERE ${HUERFANO} AND NOT ${CON_REGISTRO}`);
  console.log(`\n✓ ${del.rowCount} huérfano(s) borrado(s).`);

  const { rows: [post] } = await pool.query(
    `SELECT COUNT(*)::int n FROM "ACADEMICA_BOOKINGS" b WHERE ${HUERFANO}`);
  console.log(`Quedan huérfanos: ${post.n} (los que tienen registro).`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
