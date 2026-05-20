import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { enrollStudents } from '@/services/enrollment.service';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/events/[id]/enroll
 *
 * Enroll student(s) in an event.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  const body = await request.json();

  if (!body.studentIds || !Array.isArray(body.studentIds) || body.studentIds.length === 0) {
    throw new ValidationError('studentIds array is required and cannot be empty');
  }

  const result = await enrollStudents({
    eventId: params.id,
    studentIds: body.studentIds,
    agendadoPor: body.agendadoPor || session?.user?.name || undefined,
    agendadoPorEmail: body.agendadoPorEmail || session?.user?.email || undefined,
    agendadoPorRol: body.agendadoPorRol || (session?.user as any)?.role || undefined,
    // sessionRole NUNCA viene del body — solo de la sesión autenticada.
    // Se usa para validar bypass de estudiantes INACTIVOS (solo SUPER_ADMIN).
    sessionRole: (session?.user as any)?.role || undefined,
  });

  return successResponse({
    bookings: result.bookings,
    enrolled: result.enrolled,
    message: `${result.enrolled} estudiante(s) inscrito(s) exitosamente`,
  });
});
