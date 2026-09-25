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
  // Alcance "del alumno": curso y salón con el comodín 'Todos' (ver
  // calendar.repository). Es lo que usa el wizard de /student para Talleres,
  // Olimpiadas y Nivelación: un taller creado para "Todos" los cursos no tiene
  // curso ni módulo que coincidan con los del alumno, y con `nivel`/`curso`
  // exactos no aparecía.
  const cursoAlumno = searchParams.get('cursoAlumno');
  const salonAlumno = searchParams.get('salonAlumno');
  const step = searchParams.get('step');
  const tipo = searchParams.get('tipo') || searchParams.get('tipoEvento');
  const advisor = searchParams.get('advisor');
  const startDate = searchParams.get('fechaInicio') || searchParams.get('startDate');
  const endDate = searchParams.get('fechaFin') || searchParams.get('endDate');
  const includeBookingCounts = searchParams.get('includeBookings') === 'true';

  const events = await getEvents({
    nivel: nivel || undefined,
    curso: curso || undefined,
    cursoAlumno: cursoAlumno || undefined,
    salonAlumno: salonAlumno || undefined,
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
