/**
 * Student Booking Service
 *
 * Business logic for student self-booking: browse available events,
 * book with capacity/weekly-limit/same-day checks, and cancel.
 */

import 'server-only';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { StepOverridesRepository } from '@/repositories/niveles.repository';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { queryMany, queryOne } from '@/lib/postgres';

// --- Helpers (mirrors progress.service.ts logic) ---

function extractStepNumber(stepName: string): number | null {
  const match = stepName?.match(/Step\s*(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function isExitosaBooking(c: any): boolean {
  return c.asistio === true || c.asistencia === true;
}

/**
 * Strict approval rule for a Jump booking (Step 5, 10, 15, ...):
 *   asistencia=true AND participacion=true AND noAprobo!==true AND not cancelled.
 */
function aproboElJumpBooking(c: any): boolean {
  const asistio = c.asistio === true || c.asistencia === true;
  return asistio
      && c.participacion === true
      && c.noAprobo !== true
      && c.cancelo !== true;
}

function getClassTypeBooking(c: any): 'SESSION' | 'CLUB' | 'OTHER' {
  if (c.tipo === 'SESSION' || c.tipo === 'COMPLEMENTARIA') return 'SESSION';
  if (c.tipo === 'CLUB') return 'CLUB';
  if (!c.tipo && c.step) {
    if (/^TRAINING\s*-/i.test(c.step)) return 'CLUB';
    if (/^Step\s+\d+$/i.test(c.step)) return 'SESSION';
  }
  return 'OTHER';
}

/**
 * Determines the first incomplete step number for a student in their current nivel.
 * Returns 0 if all steps are complete or nivel has no steps in NIVELES.
 */
export async function getEffectiveStepNumber(
  academicaId: string,
  nivel: string
): Promise<number> {
  if (!nivel) return 0;

  const stepsRows = await queryMany<{ step: string }>(
    `SELECT DISTINCT "step" FROM "NIVELES" WHERE "code" = $1 AND "step" != 'WELCOME' ORDER BY "step"`,
    [nivel]
  );
  if (stepsRows.length === 0) return 0;

  const allSteps = stepsRows
    .map(r => r.step)
    .sort((a, b) => (extractStepNumber(a) ?? 0) - (extractStepNumber(b) ?? 0));

  const classes = await queryMany(
    `SELECT b."tipo", b."nombreEvento", b."asistio", b."asistencia", b."participacion", b."noAprobo",
            COALESCE(c."step", b."step") AS "step"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
     WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
       AND COALESCE(c."nivel", b."nivel") = $2
       AND (b."cancelo" IS NULL OR b."cancelo" = false)`,
    [academicaId, nivel]
  );

  // STEP_OVERRIDES uses ACADEMICA _id (academicaId)
  const overrides = await StepOverridesRepository.findByStudentId(academicaId);
  const overrideMap = new Map(overrides.map((o: any) => [o.step, o.isCompleted]));

  for (const stepName of allSteps) {
    const stepNum = extractStepNumber(stepName);
    if (stepNum === null) continue;

    const overrideVal = overrideMap.get(stepName);
    if (overrideVal === true) continue;   // completed by override → next step
    if (overrideVal === false) return stepNum; // forced incomplete

    const clasesDelStep = classes.filter(c => {
      const n = extractStepNumber(c.step || '');
      return n === stepNum;
    });

    const esJump = stepNum > 0 && stepNum % 5 === 0;

    if (esJump) {
      // Jump approved when ANY booking satisfies the strict rule (see aproboElJumpBooking).
      // Failed attempts (noAprobo=true) on earlier bookings don't block a later success.
      const aprobado = clasesDelStep.some(c => aproboElJumpBooking(c));
      if (!aprobado) return stepNum;
    } else {
      const sesionesExitosas = clasesDelStep.filter(c => getClassTypeBooking(c) === 'SESSION' && isExitosaBooking(c)).length;
      // Only TRAINING clubs count toward step completion
      const trainingClubsExitosos = clasesDelStep.filter(c => {
        if (getClassTypeBooking(c) !== 'CLUB') return false;
        const name = c.step || c.nombreEvento || '';
        return /^TRAINING\s*-/i.test(name) && isExitosaBooking(c);
      }).length;
      if (sesionesExitosas < 2 || trainingClubsExitosos < 1) return stepNum;
    }
  }

  return 0; // all steps complete
}

const WEEKLY_SESSION_LIMIT = 2;
const WEEKLY_CLUB_LIMIT = 3;
const WEEKLY_TRAINING_LIMIT = 1;
const CANCEL_DEADLINE_MINUTES = 60;
const BOOKING_MIN_ADVANCE_MINUTES = 30;

// All events in CALENDARIO store correct UTC timestamps (fix applied 2026-04-15).
// Wix-migrated events were normalized via: dia = (dia::timestamp AT TIME ZONE 'America/Bogota')
// and origen set to 'POSTGRES'. This function is now a simple wrapper.
function eventDiaToUTC(dia: any): Date {
  return new Date(dia);
}

/**
 * Get events available for a student to book.
 * Filters by date range, nivel, tipo, and annotates each event with
 * capacity status and whether the student is already enrolled.
 * When nivelParalelo = 'ESS', also fetches ESS events and merges them.
 */
export async function getAvailableEvents(
  studentId: string,
  nivel: string,
  step: string,
  date: string,
  tipo?: string,
  tzOffset: number = 0,
  nivelParalelo?: string,
  curso?: string
) {
  // Build a date range for the selected day in the student's local timezone
  // tzOffset is in minutes from UTC (e.g., Chile UTC-3 = 180, Colombia UTC-5 = 300)
  const offsetMs = tzOffset * 60 * 1000;
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);
  // Shift to UTC: local midnight + offset = UTC equivalent
  const startDate = new Date(dayStart.getTime() + offsetMs).toISOString();
  const endDate = new Date(dayEnd.getTime() + offsetMs).toISOString();

  // MOSAICO — Talleres (CLUB) y Olimpiadas (OLIMPIADA): se filtran por CURSO
  // (YOJI/OKINA/…), no por módulo. Un alumno YOJI ve TODOS los talleres/olimpiadas
  // de YOJI sin importar su módulo actual. (Igual criterio que Nivelación.)
  // El filtro por step/jump se omite para ellos.
  const tipoUp = String(tipo || '').toUpperCase();
  const esTaller = tipoUp === 'CLUB' || tipoUp === 'OLIMPIADA';

  // When the student's main nivel is ESS, mark all their events as esESS so the UI
  // displays them correctly (orange border, "English Speaking Session" label) and
  // the step/jump filter is bypassed (ESS has no step progression requirements).
  const rawMainEvents = await CalendarioRepository.findEvents(
    (esTaller && curso)
      ? { startDate, endDate, curso, tipo }
      : { startDate, endDate, nivel, tipo }
  );
  const mainEvents = nivel === 'ESS'
    ? rawMainEvents.map((e: any) => ({ ...e, esESS: true }))
    : rawMainEvents;

  // Legacy: if student has ESS as parallel level, also fetch ESS events and merge
  let essEvents: any[] = [];
  if (nivelParalelo === 'ESS') {
    const rawEss = await CalendarioRepository.findEvents({
      startDate,
      endDate,
      nivel: 'ESS',
      tipo,
    });
    essEvents = rawEss.map((e: any) => ({ ...e, esESS: true }));
  }

  // Deduplicate by _id (avoid showing same event twice if it matches both filters)
  const seenIds = new Set(mainEvents.map((e: any) => e._id));
  const uniqueEssEvents = essEvents.filter((e: any) => !seenIds.has(e._id));
  const events = [...mainEvents, ...uniqueEssEvents];

  // Get student's upcoming bookings to check for duplicates
  const upcoming = await BookingRepository.findUpcomingByStudentId(studentId, 100);
  const enrolledEventIds = new Set(
    upcoming.map((b: any) => b.eventoId || b.idEvento)
  );

  // Get timestamps of student's existing bookings within the same UTC window
  // as the events being shown. We compare by full ISO timestamp (not just the
  // hora field) so that a past booking at 00:00 doesn't shadow a future
  // event also at 00:00 on a different day.
  const bookedTimestamps = await BookingRepository.findBookedTimestampsInRange(
    studentId, startDate, endDate
  );
  const bookedTimestampsSet = new Set(bookedTimestamps);

  // Determine the effective step based on actual progress
  const effectiveStepNum = await getEffectiveStepNumber(studentId, nivel);

  // Fallback to stored step if NIVELES has no data for this nivel
  const fallbackStepNum = extractStepNumber(step) ?? 0;
  const activeStepNum = effectiveStepNum > 0 ? effectiveStepNum : fallbackStepNum;

  const isActiveJump = activeStepNum > 0 && activeStepNum % 5 === 0;

  const now = new Date();

  // Batch count enrollments for all events in a single query (avoids N+1 pool exhaustion)
  const eventIds = events.map((e: any) => e._id);
  const enrollmentCounts = await CalendarioRepository.countActiveEnrollmentsBatch(eventIds);

  // Annotate events (no DB calls inside the loop)
  const annotated = events.map((evt: any) => {
    const evtDate = eventDiaToUTC(evt.dia);
    const minutesUntil = (evtDate.getTime() - now.getTime()) / (1000 * 60);

    // Hard-filter: events more than 60 min in the past (claramente ya pasaron)
    if (minutesUntil < -60) {
      return null;
    }

    // Same-moment exclusion: skip events at the exact same UTC timestamp as
    // an existing booking (prevents double-booking the same hour and day).
    if (bookedTimestampsSet.has(evtDate.toISOString())) {
      return null;
    }

    const activeCount = enrollmentCounts.get(evt._id) ?? 0;
    const cupoLleno = evt.limiteUsuarios > 0 && activeCount >= evt.limiteUsuarios;
    const yaInscrito = enrolledEventIds.has(evt._id);

    // Event needs > 30 min advance to book; if closer, show as disabled so the student
    // can see the session existed today (important for students in different timezones)
    const tiempoInsuficiente = minutesUntil < BOOKING_MIN_ADVANCE_MINUTES;

    // ESS y Talleres (CLUB): omiten el filtro de step/jump — se muestran todos
    // los del curso sin importar el step actual del alumno.
    if (!evt.esESS && !esTaller) {
      const evtStepNum = extractStepNumber(evt.step || evt.nombreEvento || '');
      const isJumpEvent = evtStepNum !== null && evtStepNum > 0 && evtStepNum % 5 === 0;

      if (isActiveJump) {
        // Student completed all regular steps → show ONLY the specific jump event
        if (!isJumpEvent || evtStepNum !== activeStepNum) return null;
      } else {
        // Student is on a regular step → show all non-jump events, hide jump events
        if (isJumpEvent) return null;
      }
    }

    return {
      ...evt,
      inscritos: activeCount,
      cupoLleno,
      yaInscrito,
      tiempoInsuficiente,
    };
  });

  return annotated.filter(Boolean);
}

/**
 * Book a student into an event with full validation:
 * 1. Event exists and is in the future
 * 2. Capacity not exceeded
 * 3. Not already enrolled
 * 4. Weekly session/club limits not exceeded
 * 5. No duplicate session on the same day
 */
export async function bookEvent(
  studentId: string,
  studentData: {
    primerNombre: string;
    primerApellido: string;
    numeroId: string;
    celular?: string;
    nivel?: string;
    step?: string;
    plataforma?: string;
  },
  eventId: string
) {
  // 0. Verify student is not blocked (defensa en profundidad — la sesión
  //    JWT puede seguir activa después de inactivar al estudiante).
  //    Bloquea si CUALQUIERA de ACADEMICA o PEOPLE marca estadoInactivo=true.
  const inactivoCheck = await queryOne<{ inactivo: boolean }>(
    `SELECT (
       COALESCE((SELECT a."estadoInactivo"::boolean FROM "ACADEMICA" a WHERE a."_id" = $1 LIMIT 1), false)
       OR
       COALESCE((SELECT p."estadoInactivo" FROM "PEOPLE" p
                 WHERE p."numeroId" = $2 AND p."tipoUsuario" = 'BENEFICIARIO'
                 ORDER BY p."estadoInactivo" DESC NULLS LAST LIMIT 1), false)
     ) AS inactivo`,
    [studentId, studentData.numeroId || '']
  );
  if (inactivoCheck?.inactivo) {
    throw new ForbiddenError('Tu cuenta está inactiva. No puedes agendar clases. Por favor contacta al Área de Servicio.');
  }

  // 1. Get event
  const event = await CalendarioRepository.findByIdWithAdvisor(eventId);
  if (!event) throw new NotFoundError('Evento', eventId);

  // 2. Validate future date + 30 min advance
  const eventDate = eventDiaToUTC(event.dia);
  const now = new Date();
  const minutesUntil = (eventDate.getTime() - now.getTime()) / (1000 * 60);
  if (minutesUntil <= 0) {
    throw new ValidationError('No se puede agendar en un evento pasado');
  }
  if (minutesUntil < BOOKING_MIN_ADVANCE_MINUTES) {
    throw new ValidationError(`Debes agendar con al menos ${BOOKING_MIN_ADVANCE_MINUTES} minutos de anticipación`);
  }

  // 3. Check capacity using real active enrollment count
  const activeCount = await CalendarioRepository.countActiveEnrollments(eventId);
  if (event.limiteUsuarios && event.limiteUsuarios > 0 && activeCount >= event.limiteUsuarios) {
    throw new ConflictError('El evento está lleno');
  }

  // 4. Check not already enrolled
  const alreadyEnrolled = await BookingRepository.existsByStudentAndEvent(studentId, eventId);
  if (alreadyEnrolled) {
    throw new ConflictError('Ya estás inscrito en este evento');
  }

  const eventTipo = event.tipo || event.evento || '';

  // 5. Pending SESSION rule: can't book a new SESSION if you already have one pending
  if (eventTipo === 'SESSION') {
    const hasPending = await BookingRepository.hasPendingSession(studentId);
    if (hasPending) {
      throw new ConflictError('Ya tienes una sesión reservada y pendiente. Solo puedes reservar otra cuando pase tu sesión actual.');
    }
  }

  // 6. Check weekly limits
  const eventDay = eventDiaToUTC(event.dia);
  const dayOfWeek = eventDay.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(eventDay);
  weekStart.setDate(eventDay.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const weeklyCounts = await BookingRepository.countWeeklyBookingsByType(
    studentId,
    weekStart.toISOString(),
    weekEnd.toISOString()
  );

  const weeklyMap: Record<string, number> = {};
  for (const row of weeklyCounts) {
    weeklyMap[(row as any).tipo] = (row as any).count;
  }

  if (eventTipo === 'SESSION') {
    const currentSessions = weeklyMap['SESSION'] || 0;
    if (currentSessions >= WEEKLY_SESSION_LIMIT) {
      throw new ConflictError(`Límite semanal alcanzado: máximo ${WEEKLY_SESSION_LIMIT} sesiones por semana`);
    }
  }

  if (eventTipo === 'CLUB') {
    const currentClubs = weeklyMap['CLUB'] || 0;
    if (currentClubs >= WEEKLY_CLUB_LIMIT) {
      throw new ConflictError(`Límite semanal alcanzado: máximo ${WEEKLY_CLUB_LIMIT} clubs por semana`);
    }

    // TRAINING limit: max 1 per week
    const eventName = event.nombreEvento || event.titulo || '';
    const isTraining = /^TRAINING\s*-/i.test(eventName);
    if (isTraining) {
      const currentTrainings = await BookingRepository.countWeeklyTrainingBookings(
        studentId,
        weekStart.toISOString(),
        weekEnd.toISOString()
      );
      if (currentTrainings >= WEEKLY_TRAINING_LIMIT) {
        throw new ConflictError(`Límite semanal alcanzado: máximo ${WEEKLY_TRAINING_LIMIT} TRAINING por semana`);
      }
    }
  }

  // 6. Check no duplicate session on same day
  if (eventTipo === 'SESSION') {
    const dateStr = eventDay.toISOString().split('T')[0];
    const hasSameDay = await BookingRepository.existsSameDaySession(studentId, dateStr);
    if (hasSameDay) {
      throw new ConflictError('Ya tienes una sesión agendada para este día');
    }
  }

  // 7. Create booking
  const bookingData: Record<string, any> = {
    _id: ids.booking(),
    eventoId: eventId,
    idEvento: eventId,
    studentId: studentId,
    idEstudiante: studentId,
    primerNombre: studentData.primerNombre,
    primerApellido: studentData.primerApellido,
    numeroId: studentData.numeroId,
    celular: studentData.celular || '',
    plataforma: studentData.plataforma || null,
    nivel: event.nivel || event.tituloONivel || studentData.nivel,
    step: event.step || studentData.step,
    advisor: event.advisor,
    fecha: event.dia,
    fechaEvento: event.dia,
    hora: event.hora,
    tipo: eventTipo,
    tipoEvento: eventTipo,
    linkZoom: event.linkZoom,
    nombreEvento: event.nombreEvento || event.titulo,
    tituloONivel: event.tituloONivel || event.nivel,
    asistio: false,
    asistencia: false,
    participacion: false,
    noAprobo: false,
    cancelo: false,
    agendadoPor: studentData.primerNombre + ' ' + studentData.primerApellido,
    agendadoPorEmail: '',
    agendadoPorRol: 'ESTUDIANTE',
    fechaAgendamiento: new Date().toISOString(),
    origen: 'PANEL_EST',
  };

  const booking = await BookingRepository.createEnrollment(bookingData);

  // 8. Increment inscritos
  await CalendarioRepository.incrementInscritos(eventId);

  return booking;
}

/**
 * Cancel a student's booking (soft cancel).
 * Validates ownership and the 60-minute cancellation deadline.
 */
export async function cancelBooking(studentId: string, bookingId: string) {
  // 1. Find booking
  const booking = await BookingRepository.findBookingById(bookingId);
  if (!booking) throw new NotFoundError('Booking', bookingId);

  // 2. Verify ownership
  if (booking.studentId !== studentId && booking.idEstudiante !== studentId) {
    throw new ForbiddenError('No puedes cancelar un booking que no es tuyo');
  }

  // 3. Check not already cancelled
  if (booking.cancelo === true) {
    throw new ConflictError('Este booking ya fue cancelado');
  }

  // 4. Check cancellation deadline (60 min before event)
  const eventDate = new Date(booking.fechaEvento);
  const now = new Date();
  const minutesUntilEvent = (eventDate.getTime() - now.getTime()) / (1000 * 60);

  if (minutesUntilEvent < CANCEL_DEADLINE_MINUTES) {
    throw new ValidationError(
      `No se puede cancelar con menos de ${CANCEL_DEADLINE_MINUTES} minutos de anticipación`
    );
  }

  // 5. Cancel
  const cancelled = await BookingRepository.cancelBooking(bookingId);

  // 6. Decrement inscritos
  const eventId = booking.eventoId || booking.idEvento;
  if (eventId) {
    await CalendarioRepository.decrementInscritos(eventId);
  }

  return { cancelled: true, booking: cancelled };
}
