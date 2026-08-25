import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { resolveStudentFromSession } from '@/services/panel-estudiante.service';
import { registrarAccesoZoom } from '@/services/zoom-acceso.service';
import { ValidationError } from '@/lib/errors';

/**
 * Registra que el alumno generó el acceso a Zoom de una de sus clases.
 *
 * El alumno sale de la SESIÓN, nunca del body: el cliente sólo dice a qué evento
 * entra, y el servicio comprueba que sea suyo y que esté en plazo.
 */
export const POST = handlerWithAuth(async (request, context, session) => {
  const student = await resolveStudentFromSession(session);

  const body = await request.json().catch(() => ({} as any));
  const eventoId = String(body?.eventoId || '').trim();
  if (!eventoId) throw new ValidationError('eventoId es requerido');

  // `x-forwarded-for` viene como cadena de proxies; la primera IP es el cliente.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip') || null;

  const result = await registrarAccesoZoom(student.academicaId || student._id, {
    eventoId, ip, userAgent: request.headers.get('user-agent'),
  });
  return successResponse(result);
});
