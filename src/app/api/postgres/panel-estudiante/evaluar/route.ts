/**
 * POST /api/postgres/panel-estudiante/evaluar
 *
 * Guarda una evaluación. El service valida TODO server-side:
 *   - feature flag activo para este email
 *   - booking pertenece al estudiante autenticado
 *   - asistencia OK + no cancelado + tipo evaluable + nivel != WELCOME
 *   - no evaluado previamente
 *   - 4 ratings en [1..5], comentario ≤ 250 chars
 *   - comentario sin lenguaje ofensivo (blacklist local + OpenAI Moderation)
 *
 * Body:
 *   {
 *     bookingId, puntualidad, claridad, actividades, ambiente, comentario?
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

  // Las bookings se enlazan con ACADEMICA._id vía studentId/idEstudiante.
  // resolveStudentFromSession devuelve _id = PEOPLE._id y academicaId aparte.
  const academicaId = (student as any).academicaId || student._id;

  const created = await submitEvaluation({
    email,
    academicaId,
    bookingId: body.bookingId,
    puntualidad: Number(body.puntualidad),
    claridad:    Number(body.claridad),
    actividades: Number(body.actividades),
    ambiente:    Number(body.ambiente),
    comentario:  body.comentario ?? null,
    ip, userAgent,
  });

  return successResponse({ evaluation: created });
});
