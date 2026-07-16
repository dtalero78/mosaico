/**
 * Booking Repository
 *
 * All SQL for the ACADEMICA_BOOKINGS table (~8 route handlers).
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { buildDynamicUpdate } from '@/lib/query-builder';

class BookingRepositoryClass extends BaseRepository {
  constructor() {
    super('ACADEMICA_BOOKINGS');
  }

  /**
   * Get bookings for an event with student details from PEOPLE
   */
  async findByEventIdWithStudents(eventId: string, limit: number = 200) {
    return queryMany(
      `SELECT ab."_id", ab."studentId", ab."eventoId", ab."tipo", ab."fecha", ab."hora",
              ab."advisor", ab."nivel", ab."step", ab."asistencia", ab."asistio",
              ab."participacion", ab."noAprobo", ab."cancelo", ab."calificacion",
              ab."anotaciones", ab."comentarios", ab."advisorAnotaciones", ab."actividadPropuesta",
              ab."linkZoom", ab."asignadoPor", ab."origen", ab."agendadoPor",
              ab."agendadoPorEmail", ab."agendadoPorRol", ab."fechaAgendamiento",
              ab."fechaEvento", ab."tipoEvento", ab."nombreEvento", ab."tituloONivel",
              ab."_createdDate", ab."_updatedDate",
              p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
              p."email", p."celular", p."numeroId", p."tipoUsuario"
       FROM "ACADEMICA_BOOKINGS" ab
       LEFT JOIN "PEOPLE" p ON ab."studentId" = p."_id"
       WHERE ab."eventoId" = $1
       ORDER BY p."primerNombre" ASC, p."primerApellido" ASC
       LIMIT $2`,
      [eventId, limit]
    );
  }

  /**
   * Get bookings for a calendar event (simple, no JOIN)
   */
  async findByEventId(eventId: string) {
    return queryMany(
      `SELECT * FROM "ACADEMICA_BOOKINGS"
       WHERE ("eventoId" = $1 OR "idEvento" = $1)
         AND ("cancelo" IS NULL OR "cancelo" = false)
       ORDER BY "primerApellido", "primerNombre"`,
      [eventId]
    );
  }

  /**
   * Find a single booking by student ID and event ID
   */
  async findByStudentAndEvent(studentId: string, eventId: string) {
    return queryOne(
      `SELECT * FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND ("eventoId" = $2 OR "idEvento" = $2)
         AND "cancelo" = false
       LIMIT 1`,
      [studentId, eventId]
    );
  }

  /**
   * Get bookings with extended student info
   */
  async findByEventIdWithStudentDetails(eventId: string) {
    return queryMany(
      `SELECT DISTINCT ON (b."_id") b.*,
              COALESCE(a."email", p."email") as "studentEmail",
              COALESCE(p."plataforma", a."plataforma") as "studentPlataforma",
              p."estadoInactivo" as "studentInactivo", p."vigencia" as "studentVigencia",
              p."finalContrato" as "studentFinalContrato"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "ACADEMICA" a ON b."idEstudiante" = a."_id"
       LEFT JOIN "PEOPLE" p ON a."numeroId" = p."numeroId"
       WHERE (b."eventoId" = $1 OR b."idEvento" = $1)
         AND (b."cancelo" IS NULL OR b."cancelo" = false)
       ORDER BY b."_id", b."primerApellido", b."primerNombre"`,
      [eventId]
    );
  }

  /**
   * Get a student's class history
   */
  async findByStudentId(studentId: string, limit: number = 500) {
    // Pre-resolver TODOS los IDs candidatos del estudiante en 1 query rapida
    // (~5ms con indices). Esto elimina la subquery anidada de 2 niveles que
    // disparaba Seq Scan en la query principal.
    //
    // Razón: un estudiante puede tener bookings agendados con:
    //   - su ACADEMICA._id           (studentId param directamente)
    //   - su PEOPLE._id correspondiente (mismo numeroId que ACADEMICA)
    //   - duplicados en PEOPLE (BENEFICIARIO+TITULAR mismo numeroId)
    const idsRow = await queryMany<{ id: string }>(
      `SELECT a."_id" AS id FROM "ACADEMICA" a WHERE a."_id" = $1
       UNION
       SELECT p."_id" AS id FROM "PEOPLE" p
        WHERE p."numeroId" = (
          SELECT a."numeroId" FROM "ACADEMICA" a WHERE a."_id" = $1 LIMIT 1
        )`,
      [studentId]
    );
    const candidateIds = idsRow.map(r => r.id);
    if (candidateIds.length === 0) candidateIds.push(studentId);

    // Query principal con OR explicito (en vez de COALESCE) para que Postgres
    // use BitmapOr sobre los indices idx_bookings_evento + idx_bookings_idevento.
    return queryMany(
      `SELECT b."_id", b."studentId", b."eventoId", b."tipo", b."fecha", b."hora",
              b."advisor",
              COALESCE(adv."nombreCompleto", b."advisor") AS "advisorNombre",
              COALESCE(c."nivel", b."nivel") AS "nivel",
              CASE WHEN b."step" ~ '^[A-Z]+ - Step' THEN b."step"
                   ELSE COALESCE(c."step", b."step")
              END AS "step",
              b."asistencia", b."asistio", b."participacion", b."noAprobo",
              b."cancelo", b."calificacion", b."anotaciones", b."comentarios", b."advisorAnotaciones",
              b."actividadPropuesta", b."linkZoom", b."asignadoPor", b."origen",
              b."agendadoPor", b."agendadoPorEmail", b."agendadoPorRol",
              b."fechaAgendamiento", b."fechaEvento", b."tipoEvento", b."nombreEvento", b."tituloONivel",
              b."_createdDate", b."_updatedDate"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
       LEFT JOIN "GUIAS" adv ON adv."_id" = b."advisor"
       WHERE b."idEstudiante" = ANY($1::text[])
          OR b."studentId"    = ANY($1::text[])
       ORDER BY b."fechaEvento" DESC, b."hora" DESC
       LIMIT $2`,
      [candidateIds, limit]
    );
  }

  /**
   * Classes attended by nivel (for progress calculation)
   */
  async countClassesByStep(studentId: string, nivel: string) {
    return queryMany<{ step: string; totalClases: string }>(
      `SELECT DISTINCT "step", COUNT(*) as "totalClases"
       FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND "nivel" = $2
         AND "asistio" = true
       GROUP BY "step"`,
      [studentId, nivel]
    );
  }

  /**
   * Mark single attendance
   */
  async markAttendance(bookingId: string, asistio: boolean, fecha?: string) {
    return queryOne(
      `UPDATE "ACADEMICA_BOOKINGS"
       SET "asistio" = $1,
           "asistencia" = $1,
           "fecha" = COALESCE($2::timestamp with time zone, NOW()),
           "_updatedDate" = NOW()
       WHERE "_id" = $3
       RETURNING *`,
      [asistio, fecha || null, bookingId]
    );
  }

  /**
   * Bulk attendance update
   */
  async markAttendanceBulk(bookings: { bookingId: string; asistio: boolean }[]) {
    const results = [];
    for (const b of bookings) {
      if (!b.bookingId || b.asistio === undefined) continue;
      const result = await query(
        `UPDATE "ACADEMICA_BOOKINGS"
         SET "asistio" = $1, "asistencia" = $1, "fecha" = NOW(), "_updatedDate" = NOW()
         WHERE "_id" = $2
         RETURNING "_id", "asistio", "primerNombre", "primerApellido"`,
        [b.asistio, b.bookingId]
      );
      if (result.rowCount && result.rowCount > 0) {
        results.push(result.rows[0]);
      }
    }
    return results;
  }

  /**
   * Update booking fields (evaluation, comments, etc.)
   */
  async updateFields(bookingId: string, body: Record<string, any>, allowedFields: string[]) {
    const built = buildDynamicUpdate('ACADEMICA_BOOKINGS', body, allowedFields);
    if (!built) return null;
    built.values.push(bookingId);
    return queryOne(built.query, built.values);
  }

  /**
   * Enroll a student in an event
   */
  async createEnrollment(data: Record<string, any>) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    return queryOne(
      `INSERT INTO "ACADEMICA_BOOKINGS" (${columnList}, "_createdDate", "_updatedDate")
       VALUES (${placeholders}, NOW(), NOW())
       RETURNING *`,
      values
    );
  }

  /**
   * Delete a single booking (unenroll)
   */
  async deleteEnrollment(bookingId: string) {
    const result = await query(
      `DELETE FROM "ACADEMICA_BOOKINGS" WHERE "_id" = $1`,
      [bookingId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete all bookings for an event
   */
  async deleteByEventId(eventId: string) {
    const result = await query(
      `DELETE FROM "ACADEMICA_BOOKINGS"
       WHERE "eventoId" = $1 OR "idEvento" = $1
       RETURNING "_id"`,
      [eventId]
    );
    return result.rows;
  }

  /**
   * Update fields on all bookings for an event (e.g. when advisor changes)
   */
  async updateByEventId(eventId: string, fields: Record<string, any>) {
    const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
    if (keys.length === 0) return [];
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 2}`);
    const values = keys.map(k => fields[k]);
    const result = await query(
      `UPDATE "ACADEMICA_BOOKINGS" SET ${setClauses.join(', ')}, "_updatedDate" = NOW()
       WHERE "eventoId" = $1 OR "idEvento" = $1
       RETURNING "_id"`,
      [eventId, ...values]
    );
    return result.rows;
  }

  /**
   * Get booking counts for multiple events in a single query
   */
  async getBatchCounts(eventIds: string[]) {
    return queryMany(
      `SELECT
        COALESCE(b."eventoId", b."idEvento") as "eventId",
        COUNT(*) as "total",
        COUNT(CASE WHEN b."asistio" = true THEN 1 END) as "asistencias",
        COUNT(CASE WHEN b."asistio" = false THEN 1 END) as "ausencias",
        COUNT(CASE WHEN b."asistio" IS NULL THEN 1 END) as "pendientes"
      FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
        AND (b."cancelo" IS NULL OR b."cancelo" = false)
      GROUP BY COALESCE(b."eventoId", b."idEvento")`,
      [eventIds]
    );
  }

  // ── Dashboard helpers ──

  /**
   * Top students by attendance in a period
   */
  async topStudentsByAttendance(sinceDate: string, limit: number = 5) {
    return queryMany(
      `SELECT b."primerNombre", b."primerApellido", b."nivel", p."plataforma",
              COUNT(*) as asistencias
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "PEOPLE" p ON b."idEstudiante" = p."_id"
       WHERE b."asistio" = true
         AND b."fechaEvento" >= $1::timestamp
       GROUP BY b."primerNombre", b."primerApellido", b."nivel", p."plataforma"
       ORDER BY asistencias DESC
       LIMIT $2`,
      [sinceDate, limit]
    );
  }

  /**
   * Count enrollments in a date range
   */
  async countEnrollmentsInRange(startDate: string, endDate: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM "ACADEMICA_BOOKINGS"
       WHERE "fechaEvento" >= $1::timestamp AND "fechaEvento" <= $2::timestamp`,
      [startDate, endDate]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  /**
   * Get WELCOME bookings with student details for the welcome-session page.
   * Returns one row per student booking (not per event).
   */
  async findWelcomeBookings(startDate?: string, endDate?: string) {
    // Partimos desde ACADEMICA_BOOKINGS para incluir todos los bookings WELCOME,
    // incluidos los históricos de Wix que no tienen enlace a CALENDARIO.
    // LEFT JOIN a CALENDARIO en lugar de INNER JOIN para no perder esos registros.
    const conditions = [
      `(
        COALESCE(ab."tipoEvento", ab."tipo") = 'WELCOME'
        OR (c."tituloONivel" IS NOT NULL AND c."tituloONivel" ILIKE '%WELCOME%')
        OR c."tipo" = 'WELCOME'
        OR c."nivel" = 'WELCOME'
        OR ab."nivel" = 'WELCOME'
        OR (ab."tituloONivel" IS NOT NULL AND ab."tituloONivel" ILIKE '%WELCOME%')
      )`,
      `(ab."cancelo" IS NULL OR ab."cancelo" = false)`,
    ];
    const params: any[] = [];
    let paramIdx = 1;

    // Fecha se filtra por COALESCE(c."dia", ab."fechaEvento") para cubrir
    // tanto bookings con CALENDARIO enlazado como los sin enlace.
    if (startDate) {
      // ISO string con offset UTC enviado desde el cliente → inicio del día en hora local
      conditions.push(`COALESCE(c."dia", ab."fechaEvento") >= $${paramIdx}::timestamptz`);
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      // ISO string con offset UTC enviado desde el cliente → fin del día en hora local (23:59:59)
      conditions.push(`COALESCE(c."dia", ab."fechaEvento") <= $${paramIdx}::timestamptz`);
      params.push(endDate);
      paramIdx++;
    }

    return queryMany(
      `SELECT
         ab."_id",
         COALESCE(ab."primerNombre", a."primerNombre", p."primerNombre", '') as "primerNombre",
         COALESCE(ab."primerApellido", a."primerApellido", p."primerApellido", '') as "primerApellido",
         COALESCE(p."segundoNombre", a."segundoNombre", '') as "segundoNombre",
         COALESCE(p."segundoApellido", a."segundoApellido", '') as "segundoApellido",
         COALESCE(p."celular", a."celular", '') as "celular",
         COALESCE(c."dia", ab."fechaEvento") as "fechaEvento",
         ab."asistio" as "asistencia",
         COALESCE(p."numeroId", a."numeroId", '') as "numeroId",
         COALESCE(ab."studentId", ab."idEstudiante") as "idEstudiante",
         ab."nivel",
         ab."advisor",
         COALESCE(p."plataforma", a."plataforma", '') as "plataforma",
         COUNT(*) OVER (PARTITION BY COALESCE(ab."studentId", ab."idEstudiante")) as "totalSesionesWelcome"
       FROM "ACADEMICA_BOOKINGS" ab
       LEFT JOIN "CALENDARIO" c ON (c."_id" = ab."eventoId" OR c."_id" = ab."idEvento")
       LEFT JOIN "ACADEMICA" a ON (ab."studentId" = a."_id" OR ab."idEstudiante" = a."_id")
       LEFT JOIN "PEOPLE" p ON a."numeroId" = p."numeroId"
         AND (p."tipoUsuario" = 'BENEFICIARIO' OR p."tipoUsuario" = 'BENEFICIARIA')
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(c."dia", ab."fechaEvento") ASC, ab."primerApellido" ASC, ab."primerNombre" ASC`,
      params
    );
  }

  /**
   * Get SESSION bookings with student names resolved from ACADEMICA/PEOPLE
   */
  async findSessionBookings(startDate?: string, endDate?: string) {
    const conditions = [
      `(c."tituloONivel" IS NULL OR c."tituloONivel" NOT LIKE '%WELCOME%')`,
      `(ab."cancelo" IS NULL OR ab."cancelo" = false)`
    ];
    const params: any[] = [];
    let paramIdx = 1;

    if (startDate) {
      conditions.push(`c."dia" >= $${paramIdx}::timestamp`);
      params.push(startDate);
      paramIdx++;
    }
    if (endDate) {
      conditions.push(`c."dia" < $${paramIdx}::timestamp`);
      params.push(endDate);
      paramIdx++;
    }

    return queryMany(
      `SELECT
         ab."_id",
         COALESCE(ab."primerNombre", a."primerNombre", p."primerNombre", '') as "primerNombre",
         COALESCE(ab."primerApellido", a."primerApellido", p."primerApellido", '') as "primerApellido",
         COALESCE(p."segundoNombre", a."segundoNombre", '') as "segundoNombre",
         COALESCE(p."segundoApellido", a."segundoApellido", '') as "segundoApellido",
         COALESCE(p."celular", a."celular", '') as "celular",
         c."dia" as "fechaEvento",
         ab."asistio" as "asistencia",
         COALESCE(p."numeroId", a."numeroId", '') as "numeroId",
         COALESCE(ab."studentId", ab."idEstudiante") as "idEstudiante",
         COALESCE(c."nivel", ab."nivel") as "nivel",
         COALESCE(c."step", ab."step") as "step",
         COALESCE(adv."nombreCompleto", adv."primerNombre" || ' ' || adv."primerApellido", c."advisor") as "advisor",
         COALESCE(p."plataforma", a."plataforma", '') as "plataforma"
       FROM "CALENDARIO" c
       INNER JOIN "ACADEMICA_BOOKINGS" ab ON (c."_id" = ab."eventoId" OR c."_id" = ab."idEvento")
       LEFT JOIN "ACADEMICA" a ON (ab."studentId" = a."_id" OR ab."idEstudiante" = a."_id")
       LEFT JOIN "PEOPLE" p ON a."numeroId" = p."numeroId" AND p."tipoUsuario" = 'BENEFICIARIO'
       LEFT JOIN "GUIAS" adv ON c."advisor" = adv."_id"
       WHERE ${conditions.join(' AND ')}
       ORDER BY c."dia" DESC, ab."primerApellido" ASC, ab."primerNombre" ASC`,
      params
    );
  }

  // ── Panel Estudiante helpers ──

  async findUpcomingByStudentId(studentId: string, limit: number = 10) {
    return queryMany(
      `SELECT ab.*,
              COALESCE(c."step", ab."step") AS "step",
              COALESCE(c."nombreEvento", ab."nombreEvento") AS "nombreEvento",
              a."nombreCompleto" as "advisorNombre",
              c."linkZoom" as "eventLinkZoom"
       FROM "ACADEMICA_BOOKINGS" ab
       LEFT JOIN "GUIAS" a ON ab."advisor" = a."_id"
       LEFT JOIN "CALENDARIO" c ON (ab."eventoId" = c."_id" OR ab."idEvento" = c."_id")
       WHERE (ab."idEstudiante" = $1 OR ab."studentId" = $1)
         AND ab."cancelo" = false
         AND ab."fechaEvento" >= NOW() - INTERVAL '15 minutes'
       ORDER BY ab."fechaEvento" ASC
       LIMIT $2`,
      [studentId, limit]
    );
  }

  async getStudentAttendanceStats(studentId: string) {
    return queryOne(
      `SELECT
        COUNT(CASE WHEN "fechaEvento" < NOW() THEN 1 END)::int as total,
        COUNT(CASE WHEN
          "asistio" = true OR "asistencia" = true
          OR (
            (NULLIF(REGEXP_REPLACE(COALESCE("step", "nombreEvento", ''), '[^0-9]', '', 'g'), '')::int % 5 = 0)
            AND "participacion" = true
          )
        THEN 1 END)::int as asistencias,
        COUNT(CASE WHEN
          ("asistio" IS NULL OR "asistio" = false)
          AND ("asistencia" IS NULL OR "asistencia" = false)
          AND NOT (
            (NULLIF(REGEXP_REPLACE(COALESCE("step", "nombreEvento", ''), '[^0-9]', '', 'g'), '')::int % 5 = 0)
            AND "participacion" = true
          )
          AND ("cancelo" IS NULL OR "cancelo" = false)
          AND "fechaEvento" < NOW()
        THEN 1 END)::int as ausencias,
        COUNT(CASE WHEN "cancelo" = true THEN 1 END)::int as canceladas
       FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)`,
      [studentId]
    );
  }

  async findCommentsForStudent(studentId: string, limit: number = 50) {
    return queryMany(
      `SELECT ab."_id", ab."fechaEvento", ab."nivel", ab."step", ab."advisor",
              ab."advisorAnotaciones", ab."comentarios", ab."calificacion",
              a."nombreCompleto" as "advisorNombre"
       FROM "ACADEMICA_BOOKINGS" ab
       LEFT JOIN "GUIAS" a ON ab."advisor" = a."_id"
       WHERE (ab."idEstudiante" = $1 OR ab."studentId" = $1)
         AND (ab."advisorAnotaciones" IS NOT NULL AND ab."advisorAnotaciones" != ''
              OR ab."comentarios" IS NOT NULL AND ab."comentarios" != '')
       ORDER BY ab."fechaEvento" DESC
       LIMIT $2`,
      [studentId, limit]
    );
  }

  async countWeeklyBookingsByType(studentId: string, weekStart: string, weekEnd: string) {
    return queryMany(
      `SELECT COALESCE("tipo", "tipoEvento") as tipo, COUNT(*)::int as count
       FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND "fechaEvento" >= $2::timestamp
         AND "fechaEvento" <= $3::timestamp
         AND "cancelo" = false
         AND NOT (
           COALESCE("nivel", "tituloONivel") = 'WELCOME'
           AND COALESCE("tipo", "tipoEvento") = 'SESSION'
           AND ("asistio" = true OR "asistencia" = true)
         )
       GROUP BY COALESCE("tipo", "tipoEvento")`,
      [studentId, weekStart, weekEnd]
    );
  }

  async countWeeklyTrainingBookings(studentId: string, weekStart: string, weekEnd: string): Promise<number> {
    const row = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count
       FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND "fechaEvento" >= $2::timestamp
         AND "fechaEvento" <= $3::timestamp
         AND "cancelo" = false
         AND (
           COALESCE("nombreEvento", "step", '') ILIKE 'TRAINING%'
         )`,
      [studentId, weekStart, weekEnd]
    );
    return row?.count ?? 0;
  }

  async existsByStudentAndEvent(studentId: string, eventId: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT 1 FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND ("eventoId" = $2 OR "idEvento" = $2)
         AND "cancelo" = false
       LIMIT 1`,
      [studentId, eventId]
    );
    return !!row;
  }

  async existsSameDaySession(studentId: string, dateStr: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT 1 FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND DATE("fechaEvento") = $2::date
         AND COALESCE("tipo", "tipoEvento") = 'SESSION'
         AND "cancelo" = false
       LIMIT 1`,
      [studentId, dateStr]
    );
    return !!row;
  }

  async findBookingById(bookingId: string) {
    return queryOne(
      `SELECT b.*,
              COALESCE(c."step", b."step") AS "step",
              COALESCE(c."nivel", b."nivel") AS "nivel",
              COALESCE(c."tipo", b."tipoEvento") AS "tipo"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
       WHERE b."_id" = $1`,
      [bookingId]
    );
  }

  /**
   * Check if student has any future non-cancelled SESSION booking
   */
  async hasPendingSession(studentId: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT 1 FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND COALESCE("tipo", "tipoEvento") = 'SESSION'
         AND "cancelo" = false
         AND "fechaEvento" >= NOW()
       LIMIT 1`,
      [studentId]
    );
    return !!row;
  }

  /**
   * Get timestamps (ISO UTC) of bookings whose event falls within the given
   * UTC range. Used by the booking flow to prevent the student from booking
   * two events at the SAME moment in time.
   *
   * Why a range and not just a date: a previous version returned only the
   * time-of-day, which made past bookings at 00:00 block future events at
   * 00:00 (different day). Comparing full timestamps eliminates that
   * ambiguity.
   */
  async findBookedTimestampsInRange(
    studentId: string,
    startISO: string,
    endISO: string
  ): Promise<string[]> {
    const rows = await queryMany<{ ts: string }>(
      `SELECT "fechaEvento"::text AS ts FROM "ACADEMICA_BOOKINGS"
       WHERE ("idEstudiante" = $1 OR "studentId" = $1)
         AND "fechaEvento" >= $2::timestamptz
         AND "fechaEvento" <= $3::timestamptz
         AND "cancelo" = false`,
      [studentId, startISO, endISO]
    );
    // Normalize via Date so we can compare with `.toISOString()` of the
    // candidate event in JS.
    return rows.map((r) => new Date(r.ts).toISOString());
  }

  async cancelBooking(bookingId: string) {
    return queryOne(
      `UPDATE "ACADEMICA_BOOKINGS"
       SET "cancelo" = true, "_updatedDate" = NOW()
       WHERE "_id" = $1
       RETURNING *`,
      [bookingId]
    );
  }

}

export const BookingRepository = new BookingRepositoryClass();
