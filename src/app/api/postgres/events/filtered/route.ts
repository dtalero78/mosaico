import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getEvents } from '@/services/calendar.service';

/**
 * GET /api/postgres/events/filtered
 *
 * Get events filtered by multiple criteria with optional booking counts.
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);

  const nivel = searchParams.get('nivel');
  const curso = searchParams.get('curso');
  const step = searchParams.get('step');
  const tipo = searchParams.get('tipo') || searchParams.get('tipoEvento');
  const advisor = searchParams.get('advisor');
  const startDate = searchParams.get('fechaInicio') || searchParams.get('startDate');
  const endDate = searchParams.get('fechaFin') || searchParams.get('endDate');
  const includeBookingCounts = searchParams.get('includeBookings') === 'true';

  const events = await getEvents({
    nivel: nivel || undefined,
    curso: curso || undefined,
    step: step || undefined,
    tipo: tipo || undefined,
    advisor: advisor || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    includeBookingCounts,
  });

  return successResponse({
    events,
    count: events.length,
    filters: {
      nivel: nivel || null,
      step: step || null,
      tipo: tipo || null,
      advisor: advisor || null,
      fechaInicio: startDate || null,
      fechaFin: endDate || null,
    },
  });
});
