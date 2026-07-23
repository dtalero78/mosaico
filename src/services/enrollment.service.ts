/**
 * Enrollment Service
 *
 * Business logic for enrolling/unenrolling students in events.
 */

import 'server-only';
import { CalendarioRepository } from '@/repositories/calendar.repository';
import { BookingRepository } from '@/repositories/booking.repository';
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors';
import { ids } from '@/lib/id-generator';
import { eventEndDate } from '@/lib/event-duration';

interface EnrollInput {
  eventId: string;
  studentIds: string[];
  agendadoPor?: string;
  agendadoPorEmail?: string;
  agendadoPorRol?: string;
  /**
   * Rol REAL de la sesión (no se acepta del body — viene del route handler).
   * Se usa para validar el bypass de estudiantes INACTIVOS: solo SUPER_ADMIN o ADMIN.
   */
  sessionRole?: string;
}

const ROLES_SIN_LIMITE_CAPACIDAD = ['COORDINADOR_ACADEMICO', 'SERVICIO_JEFE', 'SUPER_ADMIN', 'ADMIN', 'ADMINISTRACION_JEFE'];

/**
 * Enroll multiple students in an event.
 * Checks capacity, creates bookings, and updates inscritos count.
 */
export async function enrollStudents(input: EnrollInput) {
  if (!input.studentIds || input.studentIds.length === 0) {
    throw new ValidationError('At least one studentId is required');
  }

  // Get event and check capacity
  const event = await CalendarioRepository.findByIdWithAdvisor(input.eventId);
  if (!event) throw new NotFoundError('Event', input.eventId);

  const skipCapacity = ROLES_SIN_LIMITE_CAPACIDAD.includes(input.agendadoPorRol || '');
  if (
    !skipCapacity &&
    event.limiteUsuarios &&
    event.limiteUsuarios > 0 &&
    event.inscritos >= event.limiteUsuarios
  ) {
    throw new ConflictError('Event is full');
  }

  // Fetch all students - try PEOPLE first with JOIN to ACADEMICA to get canonical ACADEMICA _id.
  // Using ACADEMICA _id is critical: historical bookings use ACADEMICA _id, not PEOPLE _id.
  // Incluimos estadoInactivo de PEOPLE y ACADEMICA por separado: bloqueamos si CUALQUIERA está inactivo.
  const { queryMany } = await import('@/lib/postgres');
  let students = await queryMany(
    `SELECT DISTINCT ON (COALESCE(a."_id", p."_id")) COALESCE(a."_id", p."_id") as "_id",
            COALESCE(p."numeroId", a."numeroId") as "numeroId",
            COALESCE(p."primerNombre", a."primerNombre") as "primerNombre",
            COALESCE(p."primerApellido", a."primerApellido") as "primerApellido",
            p."celular",
            COALESCE(p."plataforma", a."plataforma") as "plataforma",
            COALESCE(a."nivel", p."nivel") as "nivel",
            COALESCE(a."step", p."step") as "step",
            p."estadoInactivo" as "peopleEstadoInactivo",
            a."estadoInactivo"::boolean as "academicaEstadoInactivo"
     FROM "PEOPLE" p
     LEFT JOIN "ACADEMICA" a ON a."numeroId" = p."numeroId"
     WHERE p."_id" = ANY($1::text[])`,
    [input.studentIds]
  );

  // If not found in PEOPLE, the IDs might be ACADEMICA IDs - look up via ACADEMICA JOIN PEOPLE
  if (students.length < input.studentIds.length) {
    const foundIds = new Set(students.map((s: any) => s._id));
    const missingIds = input.studentIds.filter(id => !foundIds.has(id));
    if (missingIds.length > 0) {
      // ORDER BY prioriza BENEFICIARIO sobre TITULAR cuando hay duplicados
      // en PEOPLE con el mismo numeroId (caso "titular es también beneficiario").
      // Sin este ORDER BY, Postgres elegía arbitrariamente y a veces traía
      // el TITULAR (que puede tener estadoInactivo=true cuando su contrato
      // venció), bloqueando agendamientos del estudiante real (BENEFICIARIO).
      // Mismo patrón que student.service.ts usa para JOIN ACADEMICA-PEOPLE.
      const academicStudents = await queryMany(
        `SELECT DISTINCT ON (a."_id") a."_id",
                COALESCE(p."numeroId", a."numeroId") as "numeroId",
                COALESCE(p."primerNombre", a."primerNombre") as "primerNombre",
                COALESCE(p."primerApellido", a."primerApellido") as "primerApellido",
                p."celular",
                COALESCE(p."plataforma", a."plataforma") as "plataforma",
                COALESCE(a."nivel", p."nivel") as "nivel",
                COALESCE(a."step", p."step") as "step",
                p."estadoInactivo" as "peopleEstadoInactivo",
                a."estadoInactivo"::boolean as "academicaEstadoInactivo"
         FROM "ACADEMICA" a
         LEFT JOIN "PEOPLE" p ON a."numeroId" = p."numeroId"
         WHERE a."_id" = ANY($1::text[])
         ORDER BY a."_id",
                  CASE WHEN p."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA') THEN 0 ELSE 1 END,
                  p."_createdDate" ASC NULLS LAST`,
        [missingIds]
      );
      students = [...students, ...academicStudents];
    }
  }

  if (students.length === 0) {
    throw new NotFoundError('Students', input.studentIds.join(', '));
  }

  // Bloqueo de estudiantes INACTIVOS — solo SUPER_ADMIN o ADMIN pueden bypasear.
  // sessionRole viene SIEMPRE del route handler (nunca del body) — no spoofeable.
  //
  // Se bloquea SOLO por PEOPLE.estadoInactivo (la autoridad del contrato). En
  // MOSAICO un beneficiario APROBADO nace con PEOPLE activa pero ACADEMICA y login
  // inactivos hasta 1 semana antes del curso (cron activate-academica) — y su
  // sesión WELCOME es PRE-curso, así que hay que poder agendarla en ese estado.
  // Los bloqueos reales (contrato vencido, OnHold, retractado, toggle) apagan
  // SIEMPRE PEOPLE también, así que ese caso sigue bloqueado. (Verificado: los
  // PEOPLE-activa/ACADEMICA-inactiva son todos 'Aprobado' pre-curso.)
  const canBypassInactive = input.sessionRole === 'SUPER_ADMIN' || input.sessionRole === 'ADMIN';
  if (!canBypassInactive) {
    const inactivos = students.filter((s: any) => s.peopleEstadoInactivo === true);
    if (inactivos.length > 0) {
      const detalle = inactivos
        .map((s: any) => `${s.primerNombre || ''} ${s.primerApellido || ''} (${s.numeroId || s._id})`.trim())
        .join(', ');
      throw new ValidationError(
        `No se puede agendar para estudiante(s) con estado INACTIVO: ${detalle}. Consulte el Área de Servicio.`
      );
    }
  }

  // Create bookings inside a transaction so INSERT + incrementInscritos are atomic.
  // This prevents "ghost bookings" where INSERT succeeds but incrementInscritos fails.
  const { transaction } = await import('@/lib/postgres');
  const bookings: any[] = [];

  await transaction(async (client) => {
    for (const student of students) {
      // Check duplicate inside transaction using the transaction client
      const dupCheck = await client.query(
        `SELECT 1 FROM "ACADEMICA_BOOKINGS"
         WHERE ("idEstudiante" = $1 OR "studentId" = $1)
           AND ("eventoId" = $2 OR "idEvento" = $2)
           AND "cancelo" = false
         LIMIT 1`,
        [student._id, input.eventId]
      );
      if (dupCheck.rows.length > 0) {
        throw new ConflictError(`El estudiante ya está inscrito en este evento`);
      }

      // REGLA MOSAICO (prevalece, sin bypass): el alumno no puede quedar en dos
      // eventos que se CRUCEN en el tiempo — también cuando lo agenda un admin.
      // Solape real por duración (NIVELACION=30 min, resto=60).
      const evStart = new Date(event.dia);
      const evEnd = eventEndDate(evStart, event.tipo || event.evento || '');
      const overlap = await client.query(
        `SELECT b."nombreEvento", b."fechaEvento"::text AS ts
         FROM "ACADEMICA_BOOKINGS" b
         WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
           AND b."cancelo" = false
           AND b."fechaEvento" < $3::timestamptz
           AND b."fechaEvento" + (CASE WHEN UPPER(COALESCE(b."tipo", b."tipoEvento", '')) = 'NIVELACION'
                                       THEN interval '30 minutes' ELSE interval '60 minutes' END) > $2::timestamptz
         LIMIT 1`,
        [student._id, evStart.toISOString(), evEnd.toISOString()]
      );
      if (overlap.rows.length > 0) {
        const c = overlap.rows[0];
        throw new ConflictError(
          `${student.primerNombre} ${student.primerApellido} ya tiene una clase que se cruza con este horario` +
          (c.nombreEvento ? ` (${c.nombreEvento})` : '')
        );
      }
      const bookingData: Record<string, any> = {
        _id: ids.booking(),
        eventoId: input.eventId,
        idEvento: input.eventId,
        studentId: student._id,
        idEstudiante: student._id,
        primerNombre: student.primerNombre,
        primerApellido: student.primerApellido,
        numeroId: student.numeroId,
        celular: student.celular,
        plataforma: student.plataforma || null,
        nivel: event.nivel || event.tituloONivel || student.nivel,
        step: event.step || event.nombreEvento || student.step,
        advisor: event.advisor,
        fecha: event.dia,
        fechaEvento: event.dia,
        hora: event.hora,
        tipo: event.tipo || event.evento,
        tipoEvento: event.tipo || event.evento,
        linkZoom: event.linkZoom,
        nombreEvento: event.nombreEvento || event.titulo,
        tituloONivel: event.tituloONivel,
        asistio: false,
        asistencia: false,
        participacion: false,
        noAprobo: false,
        cancelo: false,
        agendadoPor: input.agendadoPor || '',
        agendadoPorEmail: input.agendadoPorEmail || '',
        agendadoPorRol: input.agendadoPorRol || '',
        fechaAgendamiento: new Date().toISOString(),
        origen: 'POSTGRES',
      };

      const columns = Object.keys(bookingData);
      const values = Object.values(bookingData);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const columnList = columns.map((c) => `"${c}"`).join(', ');
      const result = await client.query(
        `INSERT INTO "ACADEMICA_BOOKINGS" (${columnList}, "_createdDate", "_updatedDate")
         VALUES (${placeholders}, NOW(), NOW())
         RETURNING *`,
        values
      );
      if (result.rows[0]) bookings.push(result.rows[0]);
    }

    if (bookings.length > 0) {
      await client.query(
        `UPDATE "CALENDARIO" SET "inscritos" = "inscritos" + $1, "_updatedDate" = NOW() WHERE "_id" = $2`,
        [bookings.length, input.eventId]
      );
    }
  });

  return {
    bookings,
    enrolled: bookings.length,
  };
}

/**
 * Unenroll a student from an event.
 */
export async function unenrollStudent(bookingId: string, eventId: string) {
  const deleted = await BookingRepository.deleteEnrollment(bookingId);
  if (!deleted) throw new NotFoundError('Booking', bookingId);

  await CalendarioRepository.decrementInscritos(eventId);
  return { deleted: true };
}
