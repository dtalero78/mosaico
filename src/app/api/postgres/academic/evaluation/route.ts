import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { autoAdvanceStep } from '@/services/student.service';
import { autoAvanceModuloPorBooking } from '@/services/modulo-avance.service';

const EVALUATION_FIELDS = [
  'calificacion', 'advisorAnotaciones', 'comentarios',
  'participacion', 'actividadPropuesta', 'noAprobo', 'anotaciones',
];

/**
 * PUT /api/postgres/academic/evaluation
 *
 * Save evaluation for a student booking.
 */
export const PUT = handlerWithAuth(async (request) => {
  const body = await request.json();
  if (!body.bookingId) throw new ValidationError('bookingId is required');

  const booking = await BookingRepository.updateFields(body.bookingId, body, EVALUATION_FIELDS);
  if (!booking) throw new NotFoundError('Booking', body.bookingId);

  const advancement = await autoAdvanceStep(body.bookingId);
  const avanceModulo = await autoAvanceModuloPorBooking(body.bookingId);

  return successResponse({ booking, advancement, avanceModulo });
});

/**
 * POST /api/postgres/academic/evaluation
 *
 * Combined attendance + evaluation update.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();
  if (!body.bookingId) throw new ValidationError('bookingId is required');

  // Build combined fields: attendance + evaluation
  const allFields = ['asistio', 'asistencia', ...EVALUATION_FIELDS];
  const data = { ...body };
  if (data.asistio !== undefined) {
    data.asistencia = data.asistio;
  }

  const booking = await BookingRepository.updateFields(body.bookingId, data, allFields);
  if (!booking) throw new NotFoundError('Booking', body.bookingId);

  const advancement = await autoAdvanceStep(body.bookingId);
  const avanceModulo = await autoAvanceModuloPorBooking(body.bookingId);

  return successResponse({
    booking,
    advancement,
    avanceModulo,
    message: 'Evaluación y asistencia guardadas',
  });
});
