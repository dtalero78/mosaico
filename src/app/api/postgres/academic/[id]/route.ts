import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { autoAdvanceStep } from '@/services/student.service';
import { cerrarNivelacionSiRealizada } from '@/services/nivelacion.service';
import { NotFoundError } from '@/lib/errors';

const ALLOWED_BOOKING_FIELDS = [
  'asistio', 'asistencia', 'participacion', 'evaluacion',
  'comentarios', 'noAprobo', 'cancelo', 'comentarioAdvisor', 'comentarioEstudiante',
  'calificacion', 'advisorAnotaciones',
];

/**
 * GET /api/postgres/academic/[id]
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const booking = await BookingRepository.findById(params.id);
  if (!booking) throw new NotFoundError('Class record', params.id);
  return successResponse({ booking });
});

/**
 * PUT /api/postgres/academic/[id]
 *
 * Updates booking fields and triggers autoAdvanceStep when asistio=true,
 * keeping parity with /attendance and /evaluation endpoints.
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  const body = await request.json();
  const booking = await BookingRepository.updateFields(params.id, body, ALLOWED_BOOKING_FIELDS);
  if (!booking) throw new NotFoundError('Class record', params.id);

  let advancement = null;
  if (body.asistio === true || body.asistencia === true) {
    advancement = await autoAdvanceStep(params.id).catch(() => null);
  }
  // Si es una sesión de NIVELACIÓN marcada asistida+participada, cerrar la nivelación
  // (para que no quede pendiente al marcar por el modal admin, no solo por /sesion).
  const actor = (session?.user as any)?.name || session?.user?.email || 'Sistema';
  const nivelacion = await cerrarNivelacionSiRealizada(params.id, actor).catch(() => ({ cerrada: false }));

  return successResponse({ booking, advancement, nivelacion, message: 'Class record updated successfully' });
});

/**
 * DELETE /api/postgres/academic/[id]
 */
export const DELETE = handlerWithAuth(async (request, { params }) => {
  const booking = await BookingRepository.findById(params.id);
  if (!booking) throw new NotFoundError('Class record', params.id);

  const eventoId = booking.eventoId || booking.idEvento;

  await BookingRepository.deleteById(params.id);

  if (eventoId) {
    await CalendarioRepository.decrementInscritos(eventoId);
  }

  return successResponse({
    message: 'Class record deleted successfully',
    deletedId: params.id,
  });
});
