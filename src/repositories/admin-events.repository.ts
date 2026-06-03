/**
 * AdminEventsRepository — SQL para ADMIN_EVENTS.
 *
 * Modelo: 1 fila por (eventGroupId + advisorId). Si un Meeting se crea para
 * 5 advisors, son 5 filas con el mismo eventGroupId.
 *
 * Queries clave:
 *   - listForAdvisorMonth(advisorId, year, month): para panel-advisor + ctrl-horas
 *   - findConflictsInCalendario(advisorIds, rangoHorario): bloqueo pre-creación
 *   - bulkInsert(rows): inserta el lote completo
 *   - aggregateHoursByAdvisor(advisorId, year, month): suma registradas/sin registrar
 */
import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import type { AdminEventTipo } from '@/lib/admin-event-window';

export interface AdminEventRow {
  _id: string;
  eventGroupId: string;
  advisorId: string;
  tipo: AdminEventTipo;
  titulo: string | null;
  descripcion: string | null;
  fechaInicio: string;
  horas: number;
  registrado: boolean;
  fechaRegistro: string | null;
  timeout: string | null;
  notas: string | null;
  motivoCierre: 'NORMAL' | 'GESTION_COORDINADOR' | null;
  createdBy: string | null;
  _createdDate: string;
  _updatedDate: string;
}

export interface AdminEventWithAdvisor extends AdminEventRow {
  advisorNombre: string | null;
}

export const AdminEventsRepository = {

  /** Inserta múltiples filas en una sola operación (lote). */
  async bulkInsert(rows: Array<{
    _id: string;
    eventGroupId: string;
    advisorId: string;
    tipo: AdminEventTipo;
    titulo: string | null;
    descripcion: string | null;
    fechaInicio: string;
    horas: number;
    createdBy: string | null;
  }>): Promise<number> {
    if (rows.length === 0) return 0;
    const values: string[] = [];
    const params: any[] = [];
    let p = 1;
    for (const r of rows) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(r._id, r.eventGroupId, r.advisorId, r.tipo, r.titulo, r.descripcion, r.fechaInicio, r.horas, r.createdBy);
    }
    const res = await query(
      `INSERT INTO "ADMIN_EVENTS"
         ("_id","eventGroupId","advisorId","tipo","titulo","descripcion","fechaInicio","horas","createdBy")
       VALUES ${values.join(', ')}`,
      params,
    );
    return res.rowCount ?? 0;
  },

  async findById(id: string): Promise<AdminEventRow | null> {
    return queryOne<AdminEventRow>(`SELECT * FROM "ADMIN_EVENTS" WHERE "_id" = $1`, [id]);
  },

  async findByGroupId(eventGroupId: string): Promise<AdminEventRow[]> {
    return queryMany<AdminEventRow>(
      `SELECT * FROM "ADMIN_EVENTS" WHERE "eventGroupId" = $1 ORDER BY "advisorId"`,
      [eventGroupId],
    );
  },

  /**
   * Lista para el ADMIN (con filtros). JOIN a ADVISORS para mostrar nombre.
   */
  async listForAdmin(opts: {
    startDate?: string | null;
    endDate?: string | null;
    advisorId?: string | null;
    tipo?: AdminEventTipo | null;
    registrado?: boolean | null;
  }): Promise<AdminEventWithAdvisor[]> {
    const conds: string[] = ['1=1'];
    const params: any[] = [];
    let p = 1;
    if (opts.startDate) { conds.push(`ae."fechaInicio" >= $${p++}::timestamptz`); params.push(opts.startDate); }
    if (opts.endDate)   { conds.push(`ae."fechaInicio" <= $${p++}::timestamptz`); params.push(opts.endDate); }
    if (opts.advisorId) { conds.push(`ae."advisorId" = $${p++}`); params.push(opts.advisorId); }
    if (opts.tipo)      { conds.push(`ae."tipo" = $${p++}`); params.push(opts.tipo); }
    if (opts.registrado !== undefined && opts.registrado !== null) {
      conds.push(`ae."registrado" = $${p++}`); params.push(opts.registrado);
    }
    return queryMany<AdminEventWithAdvisor>(
      `SELECT ae.*, adv."nombreCompleto" AS "advisorNombre"
       FROM "ADMIN_EVENTS" ae
       LEFT JOIN "ADVISORS" adv ON adv."_id" = ae."advisorId"
       WHERE ${conds.join(' AND ')}
       ORDER BY ae."fechaInicio" DESC, adv."nombreCompleto" ASC NULLS LAST
       LIMIT 2000`,
      params,
    );
  },

  /**
   * Lista mensual para un advisor específico (panel-advisor + ctrl-horas).
   */
  async listForAdvisorMonth(advisorId: string, year: number, month: number): Promise<AdminEventRow[]> {
    const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const to   = new Date(Date.UTC(year, month, 1)).toISOString();
    return queryMany<AdminEventRow>(
      `SELECT * FROM "ADMIN_EVENTS"
       WHERE "advisorId" = $1
         AND "fechaInicio" >= $2::timestamptz
         AND "fechaInicio" <  $3::timestamptz
       ORDER BY "fechaInicio" ASC`,
      [advisorId, from, to],
    );
  },

  /**
   * Detecta conflictos con CALENDARIO académico del advisor en un rango horario.
   * Retorna eventos académicos que solapan con [fechaInicio, fechaInicio+horas).
   *
   * Solapamiento: cada evento del CALENDARIO dura 1 hora (convención del sistema),
   * por lo que [c.dia, c.dia + 1 hora) solapa con [a, b) si c.dia < b AND c.dia + 1h > a.
   */
  async findConflictsInCalendario(
    advisorIds: string[],
    fechaInicioISO: string,
    horas: number,
  ): Promise<Array<{
    advisorId: string; advisorNombre: string | null;
    eventoId: string; dia: string; tipo: string | null;
    tituloONivel: string | null;
  }>> {
    if (advisorIds.length === 0) return [];
    return queryMany<any>(
      `SELECT c."advisor"        AS "advisorId",
              adv."nombreCompleto" AS "advisorNombre",
              c."_id"            AS "eventoId",
              c."dia",
              c."tipo",
              c."tituloONivel"
       FROM "CALENDARIO" c
       LEFT JOIN "ADVISORS" adv ON adv."_id" = c."advisor"
       WHERE c."advisor" = ANY($1::text[])
         AND c."dia" <  ($2::timestamptz + ($3 || ' hours')::interval)
         AND c."dia" + INTERVAL '1 hour' > $2::timestamptz
       ORDER BY c."dia" ASC`,
      [advisorIds, fechaInicioISO, String(horas)],
    );
  },

  /**
   * Detecta conflictos con OTROS admin events del mismo advisor en el mismo rango
   * (no debería crear dos al mismo tiempo para el mismo advisor).
   * Excluye un eventGroupId opcional (para edición).
   */
  async findConflictsInAdminEvents(
    advisorIds: string[],
    fechaInicioISO: string,
    horas: number,
    excludeGroupId?: string | null,
  ): Promise<Array<{ advisorId: string; eventGroupId: string; tipo: string; fechaInicio: string; horas: number }>> {
    if (advisorIds.length === 0) return [];
    const params: any[] = [advisorIds, fechaInicioISO, String(horas)];
    let extraCond = '';
    if (excludeGroupId) {
      extraCond = ' AND "eventGroupId" <> $4';
      params.push(excludeGroupId);
    }
    return queryMany<any>(
      `SELECT "advisorId", "eventGroupId", "tipo", "fechaInicio", "horas"
       FROM "ADMIN_EVENTS"
       WHERE "advisorId" = ANY($1::text[])
         AND "fechaInicio" <  ($2::timestamptz + ($3 || ' hours')::interval)
         AND "fechaInicio" + ("horas" || ' hours')::interval > $2::timestamptz
         ${extraCond}
       ORDER BY "fechaInicio" ASC`,
      params,
    );
  },

  /**
   * Registra (cierra) un admin event. Solo si no está registrado ya.
   * Devuelve la fila actualizada, o null si no existía o ya estaba registrada.
   */
  async registrar(input: {
    id: string;
    timeout: string;
    notas: string;
    motivoCierre: 'NORMAL' | 'GESTION_COORDINADOR';
  }): Promise<AdminEventRow | null> {
    return queryOne<AdminEventRow>(
      `UPDATE "ADMIN_EVENTS"
         SET "registrado"    = true,
             "fechaRegistro" = NOW(),
             "timeout"       = $2,
             "notas"         = $3,
             "motivoCierre"  = $4,
             "_updatedDate"  = NOW()
       WHERE "_id" = $1
         AND "registrado" = false
       RETURNING *`,
      [input.id, input.timeout, input.notas, input.motivoCierre],
    );
  },

  /** Edita campos básicos (solo si NO está registrado). */
  async update(id: string, patch: Partial<{
    tipo: AdminEventTipo;
    titulo: string | null;
    descripcion: string | null;
    fechaInicio: string;
    horas: number;
  }>): Promise<AdminEventRow | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let p = 1;
    if (patch.tipo !== undefined)        { updates.push(`"tipo" = $${p++}`);        params.push(patch.tipo); }
    if (patch.titulo !== undefined)      { updates.push(`"titulo" = $${p++}`);      params.push(patch.titulo); }
    if (patch.descripcion !== undefined) { updates.push(`"descripcion" = $${p++}`); params.push(patch.descripcion); }
    if (patch.fechaInicio !== undefined) { updates.push(`"fechaInicio" = $${p++}::timestamptz`); params.push(patch.fechaInicio); }
    if (patch.horas !== undefined)       { updates.push(`"horas" = $${p++}`);       params.push(patch.horas); }
    if (updates.length === 0) return this.findById(id);
    updates.push(`"_updatedDate" = NOW()`);
    params.push(id);
    return queryOne<AdminEventRow>(
      `UPDATE "ADMIN_EVENTS" SET ${updates.join(', ')}
       WHERE "_id" = $${p} AND "registrado" = false
       RETURNING *`,
      params,
    );
  },

  async deleteById(id: string): Promise<number> {
    const r = await query(`DELETE FROM "ADMIN_EVENTS" WHERE "_id" = $1`, [id]);
    return r.rowCount ?? 0;
  },

  async deleteByGroupId(eventGroupId: string): Promise<number> {
    const r = await query(`DELETE FROM "ADMIN_EVENTS" WHERE "eventGroupId" = $1`, [eventGroupId]);
    return r.rowCount ?? 0;
  },

  /**
   * Agregado mensual de horas registradas vs sin registrar para un advisor.
   * Usado por el Dashboard advisor y Control de Horas.
   *
   * IMPORTANTE: solo cuenta eventos PASADOS (fechaInicio <= NOW()). Los eventos
   * futuros del mes no se incluyen — los KPIs reflejan actividad realmente
   * ocurrida, no agenda futura.
   */
  async aggregateHoursByAdvisorMonth(advisorId: string, year: number, month: number): Promise<{
    registradas: number;
    sinRegistrar: number;
  }> {
    const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const to   = new Date(Date.UTC(year, month, 1)).toISOString();
    const row = await queryOne<{ registradas: string | number | null; sin_registrar: string | number | null }>(
      `SELECT
         COALESCE(SUM("horas") FILTER (WHERE "registrado" = true),  0) AS "registradas",
         COALESCE(SUM("horas") FILTER (WHERE "registrado" = false), 0) AS "sin_registrar"
       FROM "ADMIN_EVENTS"
       WHERE "advisorId" = $1
         AND "fechaInicio" >= $2::timestamptz
         AND "fechaInicio" <  $3::timestamptz
         AND "fechaInicio" <= NOW()`,
      [advisorId, from, to],
    );
    return {
      registradas:   Number(row?.registradas ?? 0),
      sinRegistrar:  Number(row?.sin_registrar ?? 0),
    };
  },
};
