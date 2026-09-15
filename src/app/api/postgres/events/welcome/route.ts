import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { getEvents } from '@/services/calendar.service';
import { BookingRepository } from '@/repositories/booking.repository';
import { welcomeModuloForCurso } from '@/lib/welcome-modulo';

/**
 * GET /api/postgres/events/welcome
 *
 * Datos de WELCOME. Cuatro modos:
 *   - ?mode=bookings (default)   Agendamientos por alumno — la bandeja principal.
 *   - ?mode=events               Eventos del calendario, con conteo opcional.
 *   - ?mode=reagendamientos      Los que NO asistieron, para la bandeja de reagendar.
 *   - ?mode=futuros&curso=YOJI   Sesiones futuras del MÓDULO de ese curso, con cupo.
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'bookings';
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;

  if (mode === 'events') {
    const events = await getEvents({
      tipo: 'WELCOME',
      startDate,
      endDate,
      advisor: searchParams.get('advisor') || undefined,
      includeBookingCounts: searchParams.get('includeBookings') === 'true',
    });

    return successResponse({ events, count: events.length, tipo: 'WELCOME' });
  }

  if (mode === 'reagendamientos') {
    const events = await BookingRepository.findWelcomeInasistentes(startDate, endDate);
    return successResponse({ events, count: events.length, tipo: 'WELCOME' });
  }

  if (mode === 'futuros') {
    // El módulo se DERIVA del curso del alumno con el mismo helper que usa el alta
    // de perfil: cada grupo de cursos tiene su propia bienvenida, y ofrecer la de
    // otro programa sería mandarlo a una sesión que no le corresponde.
    const modulo = welcomeModuloForCurso(searchParams.get('curso'));
    const events = await BookingRepository.findWelcomeEventosFuturos(modulo);
    return successResponse({ events, count: events.length, modulo });
  }

  const events = await BookingRepository.findWelcomeBookings(startDate, endDate);
  return successResponse({ events, count: events.length, tipo: 'WELCOME' });
});
