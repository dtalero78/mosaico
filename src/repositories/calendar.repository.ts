/**
 * Calendar Repository
 *
 * All SQL for the CALENDARIO table (~6 route handlers).
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { buildDynamicWhere, WhereFilter } from '@/lib/query-builder';

export interface EventFilters {
  startDate?: string;
  endDate?: string;
  tipo?: string;
  advisor?: string;
  nivel?: string;
  step?: string;
  limit?: number;
  includeBookingCounts?: boolean;
}

class CalendarioRepositoryClass extends BaseRepository {
  constructor() {
    super('CALENDARIO');
  }

  /**
   * Get event by ID with advisor details
   */
  async findByIdWithAdvisor(id: string) {
    return queryOne(
      `SELECT c.*, a."primerNombre" as "advisorPrimerNombre",
              a."primerApellido" as "advisorPrimerApellido",
              a."nombreCompleto" as "advisorNombreCompleto",
              a."email" as "advisorEmail"
       FROM "CALENDARIO" c
       LEFT JOIN "ADVISORS" a ON c."advisor" = a."_id"
       WHERE c."_id" = $1`,
      [id]
    );
  }

  /**
   * Get events with dynamic filters and advisor details
   */
  async findEvents(filters: EventFilters) {
    // Build WHERE clause manually since columns have table alias
    // Note: Wix-migrated data uses "evento" instead of "tipo", and "tituloONivel" instead of "nivel"
    // We use COALESCE to check both columns
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.startDate) {
      conditions.push(`c."dia" >= $${idx}::timestamp`);
      params.push(filters.startDate);
      idx++;
    }
    if (filters.endDate) {
      conditions.push(`c."dia" <= $${idx}::timestamp`);
      params.push(filters.endDate);
      idx++;
    }
    if (filters.tipo) {
      if (filters.tipo === 'WELCOME') {
        // WELCOME is a nivel, not a tipo — match both legacy tipo and tituloONivel
        conditions.push(`(COALESCE(c."tipo", c."evento") = $${idx} OR c."tituloONivel" LIKE '%WELCOME%')`);
      } else {
        conditions.push(`COALESCE(c."tipo", c."evento") = $${idx}`);
      }
      params.push(filters.tipo);
      idx++;
    }
    if (filters.nivel) {
      conditions.push(`COALESCE(c."nivel", c."tituloONivel") = $${idx}`);
      params.push(filters.nivel);
      idx++;
    }
    if (filters.step) {
      conditions.push(`c."step" = $${idx}`);
      params.push(filters.step);
      idx++;
    }
    if (filters.advisor) {
      conditions.push(`LOWER(c."advisor") = LOWER($${idx})`);
      params.push(filters.advisor);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filters.limit ? `LIMIT $${idx}` : '';
    if (filters.limit) params.push(filters.limit);

    return queryMany(
      `SELECT c."_id", c."tipo", c."fecha", c."hora", c."advisor", c."nivel", c."step",
              c."club", c."titulo", c."observaciones", c."linkZoom", c."limiteUsuarios",
              c."inscritos", c."origen", c."dia", c."evento", c."nombreEvento", c."tituloONivel",
              c."eventoCompartidoId",
              c."sesionCerrada",
              c."_createdDate", c."_updatedDate",
              a."primerNombre" as "advisorPrimerNombre",
              a."primerApellido" as "advisorPrimerApellido",
              a."nombreCompleto" as "advisorNombreCompleto",
              a."email" as "advisorEmail"
       FROM "CALENDARIO" c
       LEFT JOIN "ADVISORS" a ON c."advisor" = a."_id"
       ${whereClause}
       ORDER BY c."dia" ASC, c."_createdDate" ASC
       ${limitClause}`,
      params
    );
  }

  /**
   * Get advisor's events with booking counts
   */
  async findAdvisorEvents(
    advisorId: string,
    opts?: { startDate?: string; endDate?: string; tipo?: string }
  ) {
    const conditions = [`c."advisor" = $1`];
    const params: any[] = [advisorId];
    let idx = 2;

    if (opts?.startDate) {
      conditions.push(`c."dia" >= $${idx++}::timestamp with time zone`);
      params.push(opts.startDate);
    }
    if (opts?.endDate) {
      conditions.push(`c."dia" <= $${idx++}::timestamp with time zone`);
      params.push(opts.endDate);
    }
    if (opts?.tipo) {
      conditions.push(`COALESCE(c."tipo", c."evento") = $${idx++}`);
      params.push(opts.tipo);
    }

    return queryMany(
      `SELECT c.*,
              COUNT(DISTINCT b."_id") as "bookingCount",
              COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "asistenciasCount",
              COUNT(DISTINCT CASE WHEN b."asistio" = false THEN b."_id" END) as "ausenciasCount"
       FROM "CALENDARIO" c
       LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento"
       WHERE ${conditions.join(' AND ')}
       GROUP BY c."_id"
       ORDER BY c."dia" DESC, c."hora" DESC`,
      params
    );
  }

  /**
   * Get events with booking counts (GROUP BY query)
   */
  async findEventsWithBookingCounts(filters: EventFilters) {
    // Same COALESCE logic as findEvents for Wix-migrated data
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.startDate) {
      conditions.push(`c."dia" >= $${idx}::timestamp with time zone`);
      params.push(filters.startDate);
      idx++;
    }
    if (filters.endDate) {
      conditions.push(`c."dia" <= $${idx}::timestamp with time zone`);
      params.push(filters.endDate);
      idx++;
    }
    if (filters.tipo) {
      if (filters.tipo === 'WELCOME') {
        conditions.push(`(COALESCE(c."tipo", c."evento") = $${idx} OR c."tituloONivel" LIKE '%WELCOME%')`);
      } else {
        conditions.push(`COALESCE(c."tipo", c."evento") = $${idx}`);
      }
      params.push(filters.tipo);
      idx++;
    }
    if (filters.nivel) {
      conditions.push(`COALESCE(c."nivel", c."tituloONivel") = $${idx}`);
      params.push(filters.nivel);
      idx++;
    }
    if (filters.step) {
      conditions.push(`c."step" = $${idx}`);
      params.push(filters.step);
      idx++;
    }
    if (filters.advisor) {
      conditions.push(`c."advisor" = $${idx}`);
      params.push(filters.advisor);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return queryMany(
      `SELECT c.*,
              a."primerNombre" as "advisorPrimerNombre",
              a."primerApellido" as "advisorPrimerApellido",
              a."nombreCompleto" as "advisorNombreCompleto",
              COUNT(DISTINCT b."_id") as "bookingCount",
              COUNT(DISTINCT CASE WHEN b."asistio" = true THEN b."_id" END) as "asistenciasCount",
              COUNT(DISTINCT CASE WHEN b."asistio" = false THEN b."_id" END) as "ausenciasCount"
       FROM "CALENDARIO" c
       LEFT JOIN "ADVISORS" a ON c."advisor" = a."_id"
       LEFT JOIN "ACADEMICA_BOOKINGS" b ON c."_id" = b."eventoId" OR c."_id" = b."idEvento"
       ${whereClause}
       GROUP BY c."_id", a."primerNombre", a."primerApellido", a."nombreCompleto"
       ORDER BY c."dia" DESC, c."hora" DESC`,
      params
    );
  }

  /**
   * Create an event
   */
  /**
   * Lista los eventos hermanos del mismo grupo compartido (incluye al evento
   * pasado). Si el evento no es compartido (eventoCompartidoId NULL), devuelve
   * sólo ese evento.
   */
  async findGroupSiblings(eventId: string) {
    return queryMany(
      `SELECT c.*, a."primerNombre" AS "advisorPrimerNombre",
              a."primerApellido" AS "advisorPrimerApellido",
              a."nombreCompleto" AS "advisorNombreCompleto"
         FROM "CALENDARIO" c
         LEFT JOIN "ADVISORS" a ON c."advisor" = a."_id"
        WHERE c."_id" = $1
           OR c."eventoCompartidoId" = (
              SELECT "eventoCompartidoId" FROM "CALENDARIO"
               WHERE "_id" = $1 AND "eventoCompartidoId" IS NOT NULL
           )
        ORDER BY c."nivel" ASC NULLS LAST`,
      [eventId]
    );
  }

  /**
   * Aplica un UPDATE a TODAS las filas que comparten el `eventoCompartidoId`
   * del evento pasado (excluyendo al evento mismo, que ya fue actualizado).
   * Sólo se permiten campos compartidos entre niveles (advisor/hora/linkZoom/
   * tipo/observaciones/limiteUsuarios). NO toca nivel/step/tituloONivel —
   * esos son específicos por fila.
   */
  async updateGroupSiblings(eventId: string, fields: Record<string, any>) {
    const cols = Object.keys(fields);
    if (cols.length === 0) return 0;
    const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
    const idx = cols.length;
    const sql = `
      UPDATE "CALENDARIO"
         SET ${sets}, "_updatedDate" = NOW()
       WHERE "_id" != $${idx + 1}
         AND "eventoCompartidoId" = (
           SELECT "eventoCompartidoId" FROM "CALENDARIO"
            WHERE "_id" = $${idx + 1} AND "eventoCompartidoId" IS NOT NULL
         )`;
    const r = await query(sql, [...Object.values(fields), eventId]);
    return r.rowCount ?? 0;
  }

  async create(data: Record<string, any>, client?: any) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    const sql = `INSERT INTO "CALENDARIO" (${columnList}, "inscritos", "origen", "_createdDate", "_updatedDate")
       VALUES (${placeholders}, 0, 'POSTGRES', NOW(), NOW())
       RETURNING *`;
    if (client) {
      const r = await client.query(sql, values);
      return r.rows[0] ?? null;
    }
    return queryOne(sql, values);
  }

  /**
   * Update event fields
   */
  async updateEvent(id: string, data: Record<string, any>, allowedFields: string[]) {
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        const cast = (field === 'dia') ? '::timestamp with time zone' : '';
        updates.push(`"${field}" = $${idx}${cast}`);
        values.push(data[field]);
        idx++;
      }
    }

    if (updates.length === 0) return null;
    updates.push(`"_updatedDate" = NOW()`);
    values.push(id);

    return queryOne(
      `UPDATE "CALENDARIO"
       SET ${updates.join(', ')}
       WHERE "_id" = $${idx}
       RETURNING *`,
      values
    );
  }

  /**
   * Increment inscritos count
   */
  async incrementInscritos(eventId: string, count: number = 1) {
    await query(
      `UPDATE "CALENDARIO"
       SET "inscritos" = "inscritos" + $1, "_updatedDate" = NOW()
       WHERE "_id" = $2`,
      [count, eventId]
    );
  }

  /**
   * Decrement inscritos count (floor at 0)
   */
  async decrementInscritos(eventId: string) {
    await query(
      `UPDATE "CALENDARIO"
       SET "inscritos" = GREATEST("inscritos" - 1, 0), "_updatedDate" = NOW()
       WHERE "_id" = $1`,
      [eventId]
    );
  }

  /**
   * Get inscritos count for capacity check
   */
  async getInscritos(eventId: string): Promise<{ _id: string; inscritos: number } | null> {
    return queryOne(
      `SELECT "_id", "inscritos" FROM "CALENDARIO" WHERE "_id" = $1`,
      [eventId]
    );
  }

  // ── Dashboard helpers ──

  async countEventsInRange(startDate: string, endDate: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "CALENDARIO"
       WHERE "dia" >= $1::timestamp AND "dia" <= $2::timestamp`,
      [startDate, endDate]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  async countUniqueAdvisorsInRange(startDate: string, endDate: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT "advisor") as count FROM "CALENDARIO"
       WHERE "dia" >= $1::timestamp AND "dia" <= $2::timestamp`,
      [startDate, endDate]
    );
    return parseInt(row?.count ?? '0', 10);
  }
  // ── Panel Estudiante helpers ──

  async countActiveEnrollments(eventId: string): Promise<number> {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "ACADEMICA_BOOKINGS"
       WHERE ("eventoId" = $1 OR "idEvento" = $1) AND "cancelo" = false`,
      [eventId]
    );
    return parseInt(row?.count ?? '0', 10);
  }

  /**
   * Batch count active enrollments for multiple events in a single query.
   * Returns a map of eventId → count.
   */
  async countActiveEnrollmentsBatch(eventIds: string[]): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await queryMany<{ evento_id: string; count: string }>(
      `SELECT COALESCE(b."eventoId", b."idEvento") AS evento_id,
              COUNT(*) AS count
       FROM "ACADEMICA_BOOKINGS" b
       WHERE (b."eventoId" = ANY($1) OR b."idEvento" = ANY($1))
         AND b."cancelo" = false
       GROUP BY COALESCE(b."eventoId", b."idEvento")`,
      [eventIds]
    );
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.evento_id, parseInt(r.count, 10));
    }
    return map;
  }
}

export const CalendarioRepository = new CalendarioRepositoryClass();
