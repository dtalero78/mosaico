import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { getAvailableEvents } from '@/services/student-booking.service';
import { ValidationError } from '@/lib/errors';

export const GET = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date) throw new ValidationError('El parámetro "date" es requerido');

  const tipo = searchParams.get('tipo') || undefined;
  const tzOffset = searchParams.get('tzOffset') ? parseInt(searchParams.get('tzOffset')!) : 0;
  const nivel = student.nivel || '';
  const step = student.step || '';
  const nivelParalelo = student.nivelParalelo || undefined;
  // Curso real del alumno (PEOPLE.tipoCurso o ACADEMICA.curso) — usado para
  // filtrar los Talleres (CLUB) por curso en vez de por módulo.
  const curso = (student as any).tipoCurso || (student as any).curso || '';
  // Salón del alumno: los Talleres y las Olimpiadas se programan para un grupo,
  // así que se acotan a su salón salvo que el evento lleve el comodín 'Todos'.
  const salon = (student as any).salon || '';

  const bookingId = student.academicaId || student._id;
  const events = await getAvailableEvents(bookingId, nivel, date, tipo, tzOffset, curso, salon);
  return successResponse({ events });
});
