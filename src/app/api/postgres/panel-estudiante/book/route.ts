import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { bookEvent } from '@/services/student-booking.service';
import { isEnabledForEmail, findEvaluablesForStudent } from '@/services/evaluations.service';
import { ValidationError } from '@/lib/errors';

export const POST = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);

  const body = await request.json();
  const { eventId } = body;
  if (!eventId) throw new ValidationError('eventId es requerido');

  const bookingId = student.academicaId || student._id;

  // Hard block server-side (defensa en profundidad): si Performance Evaluation
  // está habilitado para este estudiante y tiene evaluaciones pendientes
  // (asistencia OK + sin evaluar), no puede agendar. Cancelados/no-show no
  // entran al set de pendientes.
  const email = (session?.user as any)?.email ?? '';
  if (await isEnabledForEmail(email)) {
    const pendientes = await findEvaluablesForStudent(bookingId);
    if (pendientes.length > 0) {
      throw new ValidationError(
        `Tienes ${pendientes.length} evaluación${pendientes.length > 1 ? 'es' : ''} pendiente${pendientes.length > 1 ? 's' : ''}. Debes evaluarlas antes de agendar una nueva clase.`
      );
    }
  }

  const booking = await bookEvent(
    bookingId,
    {
      primerNombre: student.primerNombre || '',
      primerApellido: student.primerApellido || '',
      numeroId: student.numeroId || '',
      celular: student.celular || '',
      nivel: student.nivel,
      step: student.step,
      plataforma: (student as any).plataforma || '',
    },
    eventId
  );

  return successResponse({ booking }, 201);
});
