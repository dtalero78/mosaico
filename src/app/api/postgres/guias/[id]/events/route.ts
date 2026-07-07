import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getEvents } from '@/services/calendar.service';

/**
 * GET /api/postgres/guias/[id]/events
 */
export const GET = handlerWithAuth(async (request, { params }) => {
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
