import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { enrollStudents } from '@/services/enrollment.service';
import { autorizaSobrecupo } from '@/lib/sobrecupo';

/**
 * POST /api/postgres/events/welcome/reagendar
 *
 * Mueve a un alumno que faltó a su bienvenida a otra sesión WELCOME futura.
 *
 * Endpoint propio —y no el `/events/[id]/enroll` genérico— porque reagendar es
 * una ESCRITURA de Servicio con su propio permiso; el genérico sólo exige sesión,
 * así que gatear el botón sin esto sería cosmético.
 *
 * ⚠ El agendamiento de la sesión a la que faltó NO se toca: el alumno sí faltó y
 * eso es su historia. Lo que lo saca de la bandeja es tener esta sesión nueva.
 *
 * La creación la hace `enrollStudents`, que ya valida cupo, duplicado, cruce de
 * horario y estado del contrato —y contempla el caso WELCOME pre-curso, donde el
 * alumno tiene su ACADEMICA todavía inactiva—, así que no se duplica aquí.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.WELCOME_REAGENDAR);

  const body = await request.json().catch(() => ({}));
  const eventoId = String(body?.eventoId || '').trim();
  const studentId = String(body?.studentId || '').trim();

  if (!eventoId) throw new ValidationError('Falta la sesión de destino.');
  if (!studentId) throw new ValidationError('Falta el estudiante.');

  const result = await enrollStudents({
    eventId: eventoId,
    studentIds: [studentId],
    agendadoPor: session?.user?.name || undefined,
    agendadoPorEmail: session?.user?.email || undefined,
    agendadoPorRol: (session?.user as any)?.role || undefined,
    sessionRole: (session?.user as any)?.role || undefined,
    autorizarSobrecupo: body?.autorizarSobrecupo === true && await autorizaSobrecupo(session),
    autorizadoPor: session?.user?.email || undefined,
  });

  return successResponse({
    bookings: result.bookings,
    message: 'Alumno reagendado a la nueva sesión de bienvenida.',
  });
});
