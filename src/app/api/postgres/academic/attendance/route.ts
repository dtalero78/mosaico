import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { autoAdvanceStep } from '@/services/student.service';
import { autoAvanceModuloPorBooking } from '@/services/modulo-avance.service';

/**
 * POST /api/postgres/academic/attendance
 *
 * Mark single student attendance.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();

  if (!body.bookingId) throw new ValidationError('bookingId is required');
  if (body.asistio === undefined) throw new ValidationError('asistio is required');

  const booking = await BookingRepository.markAttendance(body.bookingId, body.asistio, body.fecha);
  if (!booking) throw new NotFoundError('Booking', body.bookingId);

  // Trigger auto-advance if attendance was marked as present
  let advancement = null;
  let avanceModulo = null;
  if (body.asistio === true) {
    advancement = await autoAdvanceStep(body.bookingId);
    avanceModulo = await autoAvanceModuloPorBooking(body.bookingId);
  }

  return successResponse({
    booking,
    advancement,
    avanceModulo,
    message: booking.asistio ? 'Asistencia marcada' : 'Ausencia marcada',
  });
});

/**
 * PUT /api/postgres/academic/attendance
 *
 * Bulk attendance update.
 */
export const PUT = handlerWithAuth(async (request) => {
  const body = await request.json();

  if (!body.bookings || !Array.isArray(body.bookings) || body.bookings.length === 0) {
    throw new ValidationError('bookings array is required and cannot be empty');
  }

  const results = await BookingRepository.markAttendanceBulk(body.bookings);

  // Trigger auto-advance for each booking marked as attended
  const attendedIds = body.bookings
    .filter((b: any) => b.asistio === true)
    .map((b: any) => b.bookingId);

  const advancements = await Promise.all(
    attendedIds.map((id: string) => autoAdvanceStep(id).catch(() => null))
  );
  // En serie: dos bookings del mismo alumno en paralelo podrían avanzarlo dos veces.
  for (const id of attendedIds) await autoAvanceModuloPorBooking(id);

  return successResponse({
    updated: results.length,
    bookings: results,
    advancements: advancements.filter(Boolean),
  });
});
