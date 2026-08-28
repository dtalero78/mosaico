import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { query, queryOne } from '@/lib/postgres';
import { ValidationError } from '@/lib/errors';
import { puedeConfirmarAlumno, corteConfirmacion, MENSAJE_CONFIRMACION_VENCIDA } from '@/lib/nivelacion-confirmacion';

/**
 * POST /api/postgres/panel-estudiante/nivelacion/confirmar
 *
 * El alumno confirma que asistirá a la nivelación que le pidió su guía.
 *
 * El alumno sale de la SESIÓN, nunca del body: si viniera en el cuerpo,
 * cualquiera podría confirmar la nivelación de otro. Y el plazo se revalida
 * aquí y no sólo escondiendo el botón, que es presentación, no una barrera.
 *
 * Es idempotente: volver a confirmar devuelve la confirmación que ya existe sin
 * pisar quién ni cuándo — el registro de la primera es el que vale.
 */
export const POST = handlerWithAuth(async (_request, _ctx, session) => {
  const student: any = await resolveStudentFromSession(session);
  // OJO: `_id` del perfil combinado es el de PEOPLE; ACADEMICA._id viaja en
  // `academicaId`, que es donde vive la nivelación.
  if (!student?.academicaId) throw new ValidationError('No se encontró tu registro académico');

  const row = await queryOne<{ nivelacion: boolean | null; aprobadoNivelacion: boolean | null; detalleNivelacion: any }>(
    `SELECT "nivelacion", "aprobadoNivelacion", "detalleNivelacion" FROM "ACADEMICA" WHERE "_id" = $1`,
    [student.academicaId]
  );
  const det = row?.detalleNivelacion || null;
  const viva = det?.fecha && (row?.nivelacion === true || row?.aprobadoNivelacion === true);
  if (!viva) throw new ValidationError('No tienes una nivelación pendiente de confirmar');

  if (det.confirmadoEn) {
    return successResponse({ confirmadoEn: det.confirmadoEn, confirmadoPor: det.confirmadoPor ?? null, yaEstaba: true });
  }
  if (!puedeConfirmarAlumno(det)) throw new ValidationError(MENSAJE_CONFIRMACION_VENCIDA);

  const confirmadoEn = new Date().toISOString();
  const nuevo = { ...det, confirmadoEn, confirmadoPor: 'ESTUDIANTE', confirmadoPorNombre: null };

  await query(
    `UPDATE "ACADEMICA" SET "detalleNivelacion" = $2::jsonb, "_updatedDate" = NOW() WHERE "_id" = $1`,
    [student.academicaId, JSON.stringify(nuevo)]
  );

  return successResponse({ confirmadoEn, confirmadoPor: 'ESTUDIANTE', corte: corteConfirmacion(det.fecha) });
});
