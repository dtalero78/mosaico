import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getEvents } from '@/services/calendar.service';
import { exigirGuiaPropio } from '@/services/guia-sesion.service';

/**
 * GET /api/postgres/guias/[id]/events
 */
export const GET = handlerWithAuth(async (request, { params }, session) => {
  await exigirGuiaPropio(session, params.id);
  const { searchParams } = new URL(request.url);
  const advisorId = decodeURIComponent(params.id);

  const events = await getEvents({
    advisor: advisorId,
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    tipo: searchParams.get('tipo') || undefined,
    includeBookingCounts: searchParams.get('includeBookings') === 'true',
  });

  return successResponse({ events, count: events.length, advisor: advisorId });
});
