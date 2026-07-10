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

  const { idEstudiante, idEvento, asistencia, participacion, noAprobo, calificacion, comentarios, advisorAnotaciones, actividadPropuesta } = body;

  if (!idEstudiante || !idEvento) {
    throw new ValidationError('idEstudiante and idEvento are required');
  }

  // Validación de ventana temporal: si el evento existe en CALENDARIO,
  // verificar que estamos dentro de [0..+120min] o que el rol es coordinador.
  // Si el evento no está en CALENDARIO (datos legacy de Wix sin link), no
  // bloqueamos — comportamiento previo.
  const evt = await queryOne<{ dia: Date | null; tipo: string | null }>(
    `SELECT "dia", "tipo" FROM "CALENDARIO" WHERE "_id" = $1`,
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

  // ── Cierre de NIVELACION: validaciones previas ──
  // La asistencia de una nivelación requiere marcar AMBAS (Asistió y Participó),
  // o ninguna (= no asistió). Marcar sólo una es inválido (el front lo bloquea
  // con un recordatorio; esto es defensa en profundidad).
  const esNivelacionEvt = evt?.tipo === 'NIVELACION';
  const asistioNiv = asistencia === true;
  const participoNiv = participacion === true;
  if (esNivelacionEvt) {
    if (asistioNiv !== participoNiv) {
      throw new ValidationError('La asistencia de la Nivelación requiere marcar ambas opciones (Asistió y Participó).');
    }
    if (asistioNiv && participoNiv && !(body.nivelacionComentario || '').trim()) {
      throw new ValidationError('El comentario de la nivelación es obligatorio.');
    }
  }

  const updated = await BookingRepository.updateFields(booking._id, updateData, UPDATABLE_FIELDS);
  if (!updated) {
    throw new NotFoundError('Booking', booking._id);
  }

  // ── Cierre de NIVELACION: aplicar resultado en ACADEMICA ──
  // REALIZADA (ambas marcadas): nivelacion/aprobadoNivelacion=false + comentario
  //   agregado a NivelacionHistory (conteo se conserva).
  // NO_ASISTIO (ninguna marcada): idem flags, se limpia detalleNivelacion, se baja
  //   NivelacionCount en 1 (mín 0) y se agrega entrada NO_ASISTIO al historial.
  if (esNivelacionEvt) {
    const actor = (session?.user as any)?.name || session?.user?.email || 'Sistema';
    const fecha = new Date().toISOString();
    if (asistioNiv && participoNiv) {
      const entry = { fecha, resultado: 'REALIZADA', comentario: (body.nivelacionComentario || '').trim(), marcadoPor: actor };
      await query(
        `UPDATE "ACADEMICA"
           SET "nivelacion" = false, "aprobadoNivelacion" = false,
               "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
               "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [idEstudiante, JSON.stringify([entry])]
      ).catch(err => console.warn('[academic-record] cierre nivelación REALIZADA:', err.message));
    } else {
      const entry = { fecha, resultado: 'NO_ASISTIO', marcadoPor: actor };
      await query(
        `UPDATE "ACADEMICA"
           SET "nivelacion" = false, "aprobadoNivelacion" = false,
               "detalleNivelacion" = NULL,
               "NivelacionCount" = GREATEST(0, COALESCE("NivelacionCount", 0) - 1),
               "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
               "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [idEstudiante, JSON.stringify([entry])]
      ).catch(err => console.warn('[academic-record] cierre nivelación NO_ASISTIO:', err.message));
    }
  }

  const advancement = await autoAdvanceStep(booking._id);

  return successResponse({
    booking: updated,
    advancement,
    message: 'Evaluación guardada exitosamente',
  });
});
