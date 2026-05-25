import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getEventById, updateEvent, deleteEvent } from '@/services/calendar.service';

/**
 * GET /api/postgres/events/[id]
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const event = await getEventById(params.id);
  return successResponse({ event });
});

/**
 * PUT /api/postgres/events/[id]
 *
 * Body puede incluir `_motivoCambioAdvisor` para registrar en el log
 * cuando se cambia el advisor (Ctrl Horas).
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  const body = await request.json();
  const motivo = typeof body?._motivoCambioAdvisor === 'string' ? body._motivoCambioAdvisor : undefined;
  delete body._motivoCambioAdvisor;

  const actor = (session?.user as any)?.email || 'system';
  const event = await updateEvent(params.id, body, { actor, motivo });
  return successResponse({ event });
});

/**
 * DELETE /api/postgres/events/[id]
 *
 * Querystring `motivo` opcional para registrar en el log de Suspended.
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  const { searchParams } = new URL(request.url);
  const deleteBookings = searchParams.get('deleteBookings') === 'true';
  const motivo = searchParams.get('motivo') || undefined;
  const actor = (session?.user as any)?.email || 'system';

  const result = await deleteEvent(params.id, deleteBookings, { actor, motivo });

  return successResponse({
    message: 'Evento eliminado exitosamente',
    eventId: params.id,
    bookingsDeleted: result.bookingsDeleted,
  });
});
