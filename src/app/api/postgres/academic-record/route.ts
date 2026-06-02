import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { autoAdvanceStep } from '@/services/student.service';
import { query, queryOne } from '@/lib/postgres';
import { getSessionWindow, EXPIRED_MESSAGE } from '@/lib/session-window';

const UPDATABLE_FIELDS = [
  'asistio', 'asistencia', 'participacion', 'noAprobo',
  'calificacion', 'comentarios', 'advisorAnotaciones', 'actividadPropuesta',
];

// Ensure ACADEMICA.pruebainter column exists (idempotent, once per server start)
let pruebainterColumnEnsured = false;
async function ensurePruebaInterColumn() {
  if (pruebainterColumnEnsured) return;
  try {
    await query(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "pruebainter" VARCHAR(10)`, []);
    pruebainterColumnEnsured = true;
  } catch (err: any) {
    console.warn('[academic-record] ensurePruebaInterColumn:', err.message);
  }
}

/**
 * POST /api/postgres/academic-record
 *
 * Save evaluation for a student booking by idEstudiante + idEvento.
 * Used by the session detail page (SessionStudentsTab).
 *
 * Ventana temporal: el advisor solo puede marcar asistencia/evaluación
 * desde el inicio del evento hasta +120 min después. Pasado eso, debe
 * pasar por el Coordinador Académico. Bypass por rol:
 * COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const body = await request.json();
  const sessionRole = (session?.user as any)?.role;

  const { idEstudiante, idEvento, asistencia, participacion, noAprobo, calificacion, comentarios, advisorAnotaciones, actividadPropuesta, pruebainter } = body;

  if (!idEstudiante || !idEvento) {
    throw new ValidationError('idEstudiante and idEvento are required');
  }

  // Validación de ventana temporal: si el evento existe en CALENDARIO,
  // verificar que estamos dentro de [0..+120min] o que el rol es coordinador.
  // Si el evento no está en CALENDARIO (datos legacy de Wix sin link), no
  // bloqueamos — comportamiento previo.
  const evt = await queryOne<{ dia: Date | null }>(
    `SELECT "dia" FROM "CALENDARIO" WHERE "_id" = $1`,
    [idEvento],
  );
  if (evt?.dia) {
    const ws = getSessionWindow(evt.dia, sessionRole, new Date());
    if (!ws.canMarkAttendance) {
      if (ws.isExpired) throw new ValidationError(EXPIRED_MESSAGE);
      throw new ValidationError(
        ws.minutesElapsed < 0
          ? 'El evento aún no ha comenzado — no se puede marcar asistencia todavía.'
          : 'Fuera de la ventana de registro de asistencia.',
      );
    }
  }

  // Find the booking by student + event
  const booking = await BookingRepository.findByStudentAndEvent(idEstudiante, idEvento);
  if (!booking) {
    throw new NotFoundError('Booking', `student=${idEstudiante}, event=${idEvento}`);
  }

  // Map text calificacion to integer (column is integer 0-10)
  const calificacionMap: Record<string, number> = {
    'Excelente': 10,
    'Muy Bien': 8,
    'Bien': 6,
    'Regular': 4,
    'Necesita Mejorar': 2,
  };

  // Build update data
  const updateData: Record<string, any> = {};
  if (asistencia !== undefined) {
    updateData.asistio = asistencia;
    updateData.asistencia = asistencia;
  }
  if (participacion !== undefined) updateData.participacion = participacion;
  if (noAprobo !== undefined) updateData.noAprobo = noAprobo;
  if (calificacion !== undefined && calificacion !== '') {
    const mapped = typeof calificacion === 'string' ? calificacionMap[calificacion] : undefined;
    updateData.calificacion = mapped !== undefined ? mapped : (parseInt(calificacion) || 0);
  }
  if (comentarios !== undefined) updateData.comentarios = comentarios;
  if (advisorAnotaciones !== undefined) updateData.advisorAnotaciones = advisorAnotaciones;
  if (actividadPropuesta !== undefined) updateData.actividadPropuesta = actividadPropuesta;

  const updated = await BookingRepository.updateFields(booking._id, updateData, UPDATABLE_FIELDS);
  if (!updated) {
    throw new NotFoundError('Booking', booking._id);
  }

  // Save pruebainter to ACADEMICA (only sent when evaluating Step 45 / F3 Jump).
  // Persisted BEFORE autoAdvanceStep so the promotion logic reads the latest value.
  if (pruebainter !== undefined) {
    await ensurePruebaInterColumn();
    const value = pruebainter === '' || pruebainter === null ? null : String(pruebainter);
    await query(
      `UPDATE "ACADEMICA" SET "pruebainter" = $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
      [value, idEstudiante]
    ).catch(err => console.warn('[academic-record] update pruebainter failed:', err.message));
  }

  const advancement = await autoAdvanceStep(booking._id);

  return successResponse({
    booking: updated,
    advancement,
    message: 'Evaluación guardada exitosamente',
  });
});
