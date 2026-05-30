/**
 * POST /api/postgres/panel-estudiante/evaluar
 *
 * Guarda una evaluación. El service valida TODO server-side:
 *   - feature flag activo para este email
 *   - booking pertenece al estudiante autenticado
 *   - asistencia OK + no cancelado + tipo evaluable + nivel != WELCOME
 *   - no evaluado previamente
 *   - ratings en [1..5], comentario ≤ 1000 chars
 *
 * Body:
 *   {
 *     bookingId, puntualidad, claridad, actividades,
 *     ambiente, motivacion, satisfaccionGeneral, comentario?
 *   }
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { submitEvaluation } from '@/services/evaluations.service';
import { ValidationError, NotFoundError } from '@/lib/errors';

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const body = await request.json();
  const email = (session?.user as any)?.email ?? '';

  const student = await resolveStudentFromSession(session as any);
  if (!student) throw new NotFoundError('Estudiante', email || '(sin email)');

  if (!body?.bookingId || typeof body.bookingId !== 'string') {
    throw new ValidationError('bookingId requerido');
  }

  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';

  const created = await submitEvaluation({
    email,
    academicaId: student._id,
    bookingId: body.bookingId,
    puntualidad:         Number(body.puntualidad),
    claridad:            Number(body.claridad),
    actividades:         Number(body.actividades),
    ambiente:            Number(body.ambiente),
    motivacion:          Number(body.motivacion),
    satisfaccionGeneral: Number(body.satisfaccionGeneral),
    comentario:          body.comentario ?? null,
    ip, userAgent,
  });

  return successResponse({ evaluation: created });
});
