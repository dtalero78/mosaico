/**
 * AdvisorEventLog Repository
 *
 * Snapshots inmutables de eventos en estado Canceled (cambio de advisor) o
 * Suspended (cancelación total del evento por admin).
 *
 * Tabla solo crece con INSERTs — los registros NO se modifican una vez
 * creados (auditoría perfecta). Por eso no hay método update().
 */

import 'server-only';
import { PoolClient } from 'pg';
import { queryMany, queryOne } from '@/lib/postgres';
import { ids } from '@/lib/id-generator';

export type AdvisorEventLogEstado = 'Canceled' | 'Suspended';

export interface AdvisorEventLogRow {
  _id: string;
  advisorId: string;
  eventoId: string;
  estado: AdvisorEventLogEstado;
  fechaEvento: Date | string;
  horaInicio: string | null;
  tipo: string | null;
  nivel: string | null;
  step: string | null;
  tituloEvento: string | null;
  horaFin: string | null;
  observaciones: string | null;
  canceladoPor: string;
  fechaTransicion: Date | string;
  motivoTransicion: string | null;
  _createdDate: Date | string;
}

export interface InsertLogInput {
  advisorId: string;
  eventoId: string;
  estado: AdvisorEventLogEstado;
  fechaEvento: Date | string;
  horaInicio: string | null;
  tipo: string | null;
  nivel: string | null;
  step: string | null;
  tituloEvento: string | null;
  horaFin: string | null;
  observaciones: string | null;
  canceladoPor: string;
  motivoTransicion?: string | null;
}

class AdvisorEventLogRepositoryClass {
  /**
   * INSERT con cliente externo (cuando va dentro de withTransaction).
   * Si client es null, usa el pool default.
   */
  async insert(input: InsertLogInput, client?: PoolClient): Promise<AdvisorEventLogRow> {
    const _id = ids.advisorEventLog();
    const params = [
      _id, input.advisorId, input.eventoId, input.estado,
      input.fechaEvento, input.horaInicio, input.tipo, input.nivel,
      input.step, input.tituloEvento, input.horaFin, input.observaciones,
      input.canceladoPor, input.motivoTransicion ?? null,
    ];
    const sql = `
      INSERT INTO "ADVISOR_EVENT_LOG" (
        "_id", "advisorId", "eventoId", "estado",
        "fechaEvento", "horaInicio", "tipo", "nivel",
        "step", "tituloEvento", "horaFin", "observaciones",
        "canceladoPor", "motivoTransicion"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    if (client) {
      const result: any = await client.query(sql, params);
      return result.rows[0] as AdvisorEventLogRow;
    }
    return (await queryOne<AdvisorEventLogRow>(sql, params))!;
  }

  /**
   * Cuenta entradas Canceled (cambios de advisor) para un evento dado.
   * Usado para enforzar el límite de 2 reasignaciones por evento.
   */
  async countCanceledByEvento(eventoId: string, client?: PoolClient): Promise<number> {
    const sql = `SELECT COUNT(*)::int AS n FROM "ADVISOR_EVENT_LOG" WHERE "eventoId" = $1 AND "estado" = 'Canceled'`;
    if (client) {
      const result: any = await client.query(sql, [eventoId]);
      return (result.rows[0]?.n as number) ?? 0;
    }
    const row = await queryOne<{ n: number }>(sql, [eventoId]);
    return row?.n ?? 0;
  }

  /**
   * Logs (Canceled/Suspended) del advisor en un rango.
   * Usado por la vista de Ctrl Horas para mostrar el historial.
   */
  async findByAdvisorInRange(
    advisorId: string,
    fromISO: string,
    toISO: string,
  ): Promise<AdvisorEventLogRow[]> {
    return queryMany<AdvisorEventLogRow>(
      `SELECT * FROM "ADVISOR_EVENT_LOG"
       WHERE "advisorId" = $1
         AND "fechaEvento" >= $2::timestamptz
         AND "fechaEvento" <  $3::timestamptz
       ORDER BY "fechaEvento" DESC`,
      [advisorId, fromISO, toISO],
    );
  }
}

export const AdvisorEventLogRepository = new AdvisorEventLogRepositoryClass();
