import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { getDiasConEventos } from '@/services/student-booking.service';
import { ValidationError } from '@/lib/errors';

/**
 * GET /api/postgres/panel-estudiante/available-events/dias?desde&hasta&tipo&tzOffset
 *
 * Días (YYYY-MM-DD, en la zona del alumno) del rango que tienen al menos un
 * evento del tipo pedido, con el MISMO alcance que `available-events` (curso y
 * salón del alumno para Talleres/Olimpiadas). El selector de fecha de los
 * Talleres lo usa para resaltar el miércoles y el viernes con taller programado
 * sin tener que consultar los doce días uno por uno.
 */
const MAX_DIAS = 31;
const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handlerWithAuth(async (request, _context, session) => {
  const student = await resolveStudentFromSession(session);

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get('desde') || '';
  const hasta = searchParams.get('hasta') || '';
  if (!ISO_DIA.test(desde) || !ISO_DIA.test(hasta)) {
    throw new ValidationError('Los parámetros "desde" y "hasta" son requeridos (YYYY-MM-DD)');
  }
  if (hasta < desde) throw new ValidationError('"hasta" no puede ser anterior a "desde"');
  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
  if (dias > MAX_DIAS) throw new ValidationError(`El rango no puede superar ${MAX_DIAS} días`);

  const tipo = searchParams.get('tipo') || undefined;
  const tzOffset = searchParams.get('tzOffset') ? parseInt(searchParams.get('tzOffset')!) : 0;
  const nivel = student.nivel || '';
  const curso = (student as any).tipoCurso || (student as any).curso || '';
  const salon = (student as any).salon || '';

  const fechas = await getDiasConEventos(nivel, desde, hasta, tipo, Number.isFinite(tzOffset) ? tzOffset : 0, curso, salon);
  return successResponse({ dias: fechas });
});
