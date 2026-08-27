import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { autoAdvanceStep } from '@/services/student.service';
import { cerrarNivelacionSiRealizada } from '@/services/nivelacion.service';
import { NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';

const ALLOWED_BOOKING_FIELDS = [
  'asistio', 'asistencia', 'participacion', 'evaluacion',
  'comentarios', 'noAprobo', 'cancelo', 'comentarioAdvisor', 'comentarioEstudiante',
  'calificacion', 'advisorAnotaciones',
  // Ausencia justificada: la marca y su motivo. Justificar NO descuenta la falta.
  'escusa', 'justificaescusa',
  // Módulo/lección del refuerzo. SÓLO se aceptan si el evento es una NIVELACIÓN
  // (ver la guarda del PUT): en una sesión de curso la lección la fija el
  // calendario del salón, y dejarla editable aquí la desalinearía del resto.
  'nivel', 'step',
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

  // El módulo/lección sólo se puede reasignar en una NIVELACIÓN, y se escribe
  // en el agendamiento de ESE alumno: una nivelación en grupo comparte horario,
  // pero cada uno refuerza su propio punto del curso.
  if (body.nivel !== undefined || body.step !== undefined) {
    const ev = await queryOne<{ tipo: string | null }>(
      `SELECT c."tipo" FROM "ACADEMICA_BOOKINGS" b
         LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
        WHERE b."_id" = $1`,
      [params.id]
    );
    if (String(ev?.tipo || '').toUpperCase() !== 'NIVELACION') {
      delete body.nivel;
      delete body.step;
      // Si no queda nada por actualizar, devolver el registro tal cual: seguir
      // habría hecho un UPDATE vacío y el 404 de "no encontrado" mentiría sobre
      // un agendamiento que sí existe.
      const quedan = ALLOWED_BOOKING_FIELDS.some((f) => body[f] !== undefined);
      if (!quedan) {
        const actual = await BookingRepository.findById(params.id);
        if (!actual) throw new NotFoundError('Class record', params.id);
        return successResponse({ booking: actual, advancement: null, message: 'Sin cambios aplicables' });
      }
    }
  }

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
