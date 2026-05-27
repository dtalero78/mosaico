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
 * Body puede incluir 2 metas:
 *   - `_motivoCambioAdvisor` — texto que se guarda en
 *     ADVISOR_EVENT_LOG.motivoTransicion cuando cambia el advisor.
 *   - `_skipLog: true` — modo "Restructuración" para cambio de advisor:
 *     el cambio se aplica pero NO inserta entrada Canceled en
 *     ADVISOR_EVENT_LOG (cuando es un fix de planificación, no una
 *     cancelación real del advisor original).
 *
 * Ambos campos se quitan del body antes de enviarlo al service (no son
 * columnas de CALENDARIO).
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  const body = await request.json();
  const motivo = typeof body?._motivoCambioAdvisor === 'string' ? body._motivoCambioAdvisor : undefined;
  const skipLog = body?._skipLog === true;
  delete body._motivoCambioAdvisor;
  delete body._skipLog;

  const actor = (session?.user as any)?.email || 'system';
  const event = await updateEvent(params.id, body, { actor, motivo, skipLog });
  return successResponse({ event });
});

/**
 * DELETE /api/postgres/events/[id]
 *
 * Querystring opcionales:
 *   - `motivo`           — texto que se guarda en ADVISOR_EVENT_LOG.motivoTransicion
 *   - `skipLog=true`     — modo "Restructuración": NO inserta en
 *                          ADVISOR_EVENT_LOG (borrado limpio, sin huella en
 *                          Ctrl Horas del advisor).
 *   - `deleteBookings`   — true para borrar bookings asociados (default true).
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  const { searchParams } = new URL(request.url);
  const deleteBookings = searchParams.get('deleteBookings') === 'true';
  const motivo = searchParams.get('motivo') || undefined;
  const skipLog = searchParams.get('skipLog') === 'true';
  const actor = (session?.user as any)?.email || 'system';

  const result = await deleteEvent(params.id, deleteBookings, { actor, motivo, skipLog });

  return successResponse({
    message: 'Evento eliminado exitosamente',
    eventId: params.id,
    bookingsDeleted: result.bookingsDeleted,
    skipLog,
  });
});
