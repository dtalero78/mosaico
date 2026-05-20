/**
 * PagosTitulares Repository
 *
 * SQL for the PAGOS_TITULARES table — one row per payment registered against
 * a TITULAR. Validated by RECAUDOS_JEFE/RECAUDO_ASIST before being considered
 * final.
 *
 * Schema lives in scripts/create-pagos-titulares-table.js (CREATE TABLE IF
 * NOT EXISTS, idempotent).
 */

import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { buildDynamicUpdate } from '@/lib/query-builder';

export interface PagoTitular {
  _id: string;
  idPeople: string;
  numeroId: string | null;
  gestorRecaudo: string | null;
  plataforma: string | null;
  pagoTercero: string | null;
  idTercero: string | null;
  fechaPago: string | null;
  fechaVencimiento: string | null;
  fechaValidacion: string | null;
  plan: number | null;
  vlrTotalProg: number | null;
  numCuota: number | null;
  valorCuota: number | null;
  valorPagado: number | null;
  saldo: number | null;
  descuento: number | null;
  inscripcion: number | null;
  cuotasTotal: number | null;
  medioPago: string | null;
  numeroReferencia: string | null;
  numeroFactura: string | null;
  documentosAdjuntos: any[];
  validado: boolean;
  createdBy: string | null;
  validadoPor: string | null;
  _createdDate: string;
  _updatedDate: string;
}

class PagosTitularesRepositoryClass extends BaseRepository<PagoTitular> {
  constructor() {
    super('PAGOS_TITULARES', ['documentosAdjuntos']);
  }

  /**
   * List payments of a titular ordered by fechaPago desc.
   */
  async findByIdPeople(idPeople: string): Promise<PagoTitular[]> {
    const rows = await queryMany<PagoTitular>(
      `SELECT * FROM "PAGOS_TITULARES"
       WHERE "idPeople" = $1
       ORDER BY "fechaPago" DESC NULLS LAST, "_createdDate" DESC`,
      [idPeople]
    );
    return this.parseMany(rows);
  }

  /**
   * Insert a new payment row. Caller is responsible for generating _id and
   * computing saldo (saldo = valorCuota - valorPagado - descuento).
   */
  async create(data: Partial<PagoTitular>): Promise<PagoTitular> {
    const row = await queryOne<PagoTitular>(
      `INSERT INTO "PAGOS_TITULARES" (
         "_id", "idPeople", "numeroId", "gestorRecaudo", "plataforma",
         "pagoTercero", "idTercero", "fechaPago", "fechaVencimiento",
         "plan", "vlrTotalProg", "numCuota", "cuotasTotal", "valorCuota", "valorPagado",
         "saldo", "descuento", "inscripcion", "medioPago", "numeroReferencia",
         "numeroFactura", "documentosAdjuntos", "validado", "createdBy"
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19, $20,
         $21, $22::jsonb, $23, $24
       )
       RETURNING *`,
      [
        data._id,
        data.idPeople,
        data.numeroId ?? null,
        data.gestorRecaudo ?? null,
        data.plataforma ?? null,
        data.pagoTercero ?? null,
        data.idTercero ?? null,
        data.fechaPago ?? null,
        data.fechaVencimiento ?? null,
        data.plan ?? null,
        data.vlrTotalProg ?? null,
        data.numCuota ?? null,
        data.cuotasTotal ?? null,
        data.valorCuota ?? null,
        data.valorPagado ?? null,
        data.saldo ?? null,
        data.descuento ?? 0,
        data.inscripcion ?? null,
        data.medioPago ?? null,
        data.numeroReferencia ?? null,
        data.numeroFactura ?? null,
        JSON.stringify(data.documentosAdjuntos ?? []),
        data.validado ?? false,
        data.createdBy ?? null,
      ]
    );
    return this.parse(row)!;
  }

  /**
   * Generic update by id with field whitelist.
   */
  async updateFields(id: string, body: Record<string, any>, allowedFields: string[]) {
    const built = buildDynamicUpdate('PAGOS_TITULARES', body, allowedFields);
    if (!built) return null;
    built.values.push(id);
    const row = await queryOne<PagoTitular>(built.query, built.values);
    return this.parse(row);
  }

  /**
   * Mark a payment as validated and stamp validation metadata.
   * `numeroFactura` is captured here (no en el wizard de registro) y
   * obligatorio en el flujo de validación.
   */
  async validar(id: string, validadoPor: string, numeroFactura: string): Promise<PagoTitular | null> {
    const row = await queryOne<PagoTitular>(
      `UPDATE "PAGOS_TITULARES"
       SET "validado" = true,
           "fechaValidacion" = CURRENT_DATE,
           "validadoPor" = $2,
           "numeroFactura" = $3,
           "_updatedDate" = NOW()
       WHERE "_id" = $1
       RETURNING *`,
      [id, validadoPor, numeroFactura]
    );
    return this.parse(row);
  }
}

export const PagosTitularesRepository = new PagosTitularesRepositoryClass();
