import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { queryMany, queryOne } from '@/lib/postgres';
import { NotFoundError, ValidationError } from '@/lib/errors';

/**
 * GET /api/postgres/reports/asistencia/usuario?numeroId=X&startDate=Y&endDate=Z&nivel=W
 *
 * Attendance report for a beneficiary, equivalent to the student detail
 * attendance table. Columns: fecha, tipo, advisor, nivel, step, asistio.
 * No zoom column.
 */
export const GET = handler(async (req) => {
  const { searchParams } = new URL(req.url);
  const numeroId  = searchParams.get('numeroId')?.trim();
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');
  const nivel     = searchParams.get('nivel') || null;

  if (!numeroId) throw new ValidationError('numeroId es requerido');

  // Resolve academicaId from numeroId
  const academica = await queryOne<{ _id: string; primerNombre: string; primerApellido: string; nivel: string }>(
    `SELECT "_id", "primerNombre", "primerApellido", "nivel"
     FROM "ACADEMICA"
     WHERE "numeroId" = $1
     LIMIT 1`,
    [numeroId]
  );
  if (!academica) throw new NotFoundError('Estudiante', numeroId);

  const studentId = academica._id;

  // Build WHERE conditions
  const conditions: string[] = [
    `(b."idEstudiante" = $1 OR b."studentId" = $1)`,
    `(b."cancelo" IS NULL OR b."cancelo" = false)`,
  ];
  const params: any[] = [studentId];
  let idx = 2;

  if (startDate) {
    conditions.push(`b."fechaEvento" >= $${idx}::timestamp`);
    params.push(startDate);
    idx++;
  }
  if (endDate) {
    conditions.push(`b."fechaEvento" < ($${idx}::date + INTERVAL '1 day')`);
    params.push(endDate);
    idx++;
  }
  if (nivel) {
    conditions.push(`COALESCE(c."nivel", b."nivel") = $${idx}`);
    params.push(nivel);
    idx++;
  }

  const rows = await queryMany(
    `SELECT
       b."_id",
       b."fechaEvento",
       COALESCE(c."tipo", b."tipo", b."tipoEvento")                       AS "tipo",
       b."advisor",
       COALESCE(c."nivel", b."nivel")                                      AS "nivel",
       CASE
         WHEN COALESCE(c."step", b."step", '') LIKE 'TRAINING%'
           THEN COALESCE(c."nombreEvento", b."nombreEvento", c."step", b."step")
         ELSE COALESCE(c."step", b."step")
       END                                                                  AS "step",
       b."asistio",
       b."asistencia",
       b."participacion",
       b."noAprobo",
       b."cancelo"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
     WHERE ${conditions.join(' AND ')}
     ORDER BY b."fechaEvento" DESC NULLS LAST`,
    params
  );

  return successResponse({
    student: {
      nombre: `${academica.primerNombre} ${academica.primerApellido}`,
      nivel:  academica.nivel,
      numeroId,
    },
    records: rows,
    total: rows.length,
  });
});
