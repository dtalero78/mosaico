import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { autoAdvanceStep } from '@/services/student.service';
import { autoAvanceModuloMosaico } from '@/services/modulo-avance.service';
import { query, queryOne } from '@/lib/postgres';
import { getSessionWindow, EXPIRED_MESSAGE } from '@/lib/session-window';

// Criterios de evaluación de la sesión (además de asistencia/participacion, que se
// reusan como HE_ASISTENCIA / DA_PARTICIPACION).
const CRITERIOS_EVAL = [
  'hePuntualidad', 'heAsignacion',                 // Hábitos
  'daDominio', 'daDesafio',                          // Desempeño
  'acPermanencia', 'acRespeto', 'acDisposicion',     // Actitudes
];

const UPDATABLE_FIELDS = [
  'asistio', 'asistencia', 'participacion', 'noAprobo',
  'calificacion', 'comentarios', 'advisorAnotaciones', 'actividadPropuesta',
  'casoAtencion',
  // Ausencia justificada: la falta se explica, pero SIGUE contando como ausencia
  // (no toca 'asistio'/'asistencia'). Sólo es un dato aparte.
  'escusa', 'justificaescusa',
  ...CRITERIOS_EVAL,
];

/**
 * POST /api/postgres/academic-record
 *
 * Save evaluation for a student booking by idEstudiante + idEvento.
 * Used by the session detail page (SessionStudentsTab).
 *
 * Ventana temporal: el advisor solo puede marcar asistencia/evaluación
 * desde el inicio del evento hasta +24h después. Pasado eso, debe
 * pasar por el Coordinador Académico. Bypass por rol:
 * COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const body = await request.json();
  const sessionRole = (session?.user as any)?.role;

  const { idEstudiante, idEvento, asistencia, participacion, noAprobo, calificacion, comentarios, advisorAnotaciones, actividadPropuesta, escusa, justificaescusa } = body;

  if (!idEstudiante || !idEvento) {
    throw new ValidationError('idEstudiante and idEvento are required');
  }

  // Validación de ventana temporal: si el evento existe en CALENDARIO,
  // verificar que estamos dentro de [0..+300min] o que el rol es coordinador.
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
  // Criterios de evaluación de la sesión (Hábitos / Desempeño / Actitudes).
  // asistencia = HE_ASISTENCIA y participacion = DA_PARTICIPACION se reusan arriba.
  for (const c of CRITERIOS_EVAL) {
    if (body[c] !== undefined) updateData[c] = !!body[c];
  }
  if (calificacion !== undefined && calificacion !== '') {
    const mapped = typeof calificacion === 'string' ? calificacionMap[calificacion] : undefined;
    updateData.calificacion = mapped !== undefined ? mapped : (parseInt(calificacion) || 0);
  }
  if (comentarios !== undefined) updateData.comentarios = comentarios;
  if (advisorAnotaciones !== undefined) {
    updateData.advisorAnotaciones = advisorAnotaciones;
    // Un "Caso de Atención" queda ABIERTO cuando el guía escribe texto en ese
    // campo; se marca en el booking (estudiante+evento) para el reporte de
    // Servicio › Casos Atención. Se cierra desde ahí (Resuelto).
    updateData.casoAtencion = !!(advisorAnotaciones && String(advisorAnotaciones).trim());
  }
  if (actividadPropuesta !== undefined) updateData.actividadPropuesta = actividadPropuesta;

  // Ausencia justificada. La coherencia se resuelve AQUÍ y no sólo en el front
  // porque ya son dos las pantallas que escriben estos campos (el panel del Guía
  // y el modal "Detalles de la Clase" del panel admin): si el alumno asistió, no
  // hay ausencia que justificar, así que la marca y el motivo se limpian.
  if (escusa !== undefined) updateData.escusa = !!escusa;
  if (justificaescusa !== undefined) updateData.justificaescusa = justificaescusa;
  if (asistencia === true) {
    updateData.escusa = false;
    updateData.justificaescusa = '';
  }

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
    const fechaEvento = evt?.dia ? new Date(evt.dia).toISOString() : null;
    // Conteo de la nivelación (número de esta nivelación: 1ª, 2ª…). Se lee ANTES
    // de modificar y se guarda en el registro del historial.
    const curNiv = await queryOne<{ NivelacionCount: number | null; detalleNivelacion: any }>(
      `SELECT "NivelacionCount", "detalleNivelacion" FROM "ACADEMICA" WHERE "_id" = $1`, [idEstudiante]
    );
    const conteo = Number(curNiv?.NivelacionCount) || 0;
    // Lo que se pidió: cuándo y sobre qué. Se guarda en la entrada del historial
    // porque `detalleNivelacion` se pisa con la siguiente nivelación del alumno.
    let det: any = curNiv?.detalleNivelacion;
    if (typeof det === 'string') { try { det = JSON.parse(det); } catch { det = null; } }
    const fechaSolicitud = det?.fecha || null;
    const modulo = det?.modulo || null;
    const leccion = det?.leccion || null;
    if (asistioNiv && participoNiv) {
      const entry = { fecha, fechaEvento, fechaSolicitud, modulo, leccion, conteo, resultado: 'REALIZADA', comentario: (body.nivelacionComentario || '').trim(), marcadoPor: actor };
      await query(
        `UPDATE "ACADEMICA"
           SET "nivelacion" = false, "aprobadoNivelacion" = false,
               "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
               "_updatedDate" = NOW()
         WHERE "_id" = $1`,
        [idEstudiante, JSON.stringify([entry])]
      ).catch(err => console.warn('[academic-record] cierre nivelación REALIZADA:', err.message));
    } else {
      const entry = { fecha, fechaEvento, fechaSolicitud, modulo, leccion, conteo, resultado: 'NO_ASISTIO', marcadoPor: actor };
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
  // MOSAICO: avanzar de módulo si quedó completo (lecciones + evaluación aprobadas).
  let avanceModulo: any = null;
  try { avanceModulo = await autoAvanceModuloMosaico(idEstudiante); } catch { /* best-effort */ }

  return successResponse({
    booking: updated,
    advancement,
    avanceModulo,
    message: 'Evaluación guardada exitosamente',
  });
});
