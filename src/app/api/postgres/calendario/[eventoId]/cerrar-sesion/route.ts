import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { UnauthorizedError } from '@/lib/errors';
import { closeSession } from '@/services/advisor-event-log.service';

/**
 * POST /api/postgres/calendario/[eventoId]/cerrar-sesion
 *
 * Botón "Registrar Sesión" del advisor. Marca el evento como cerrado.
 * Si notasadvisor está vacío, set automáticamente "no hubo novedades".
 * Requiere timeout previamente guardado.
 */
export const POST = handlerWithAuth(async (_request, { params }, session) => {
  const email = (session?.user as any)?.email;
  if (!email) throw new UnauthorizedError('Sesión sin email');

  const result = await closeSession(params.eventoId, email);
  return successResponse(result);
});
