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
   * Lista paginada de pagos con datos del titular (JOIN PEOPLE) para el
   * Centro de Validación de Pagos. Excluye cuota#0 (inscripción auto-validada).
   *
   * Filtros opcionales:
   * - estado: 'validado' | 'pendiente' | undefined (todos)
   * - fechaDesde / fechaHasta: rango sobre fechaPago (YYYY-MM-DD)
   * - search: ILIKE sobre primerNombre, primerApellido, segundoApellido del titular
   */
  async findAllWithTitular(opts: {
    estado?: 'validado' | 'pendiente';
    fechaDesde?: string | null;
    fechaHasta?: string | null;
    search?: string | null;
    limit: number;
    offset: number;
  }): Promise<{ rows: any[]; total: number }> {
    const conds: string[] = [`COALESCE(pt."numCuota", 0) > 0`]; // excluye cuota #0
    const params: any[] = [];
    let i = 1;

    if (opts.estado === 'validado') conds.push(`pt."validado" = true`);
    else if (opts.estado === 'pendiente') conds.push(`pt."validado" = false`);

    if (opts.fechaDesde) { conds.push(`pt."fechaPago" >= $${i}::date`); params.push(opts.fechaDesde); i++; }
    if (opts.fechaHasta) { conds.push(`pt."fechaPago" <= $${i}::date`); params.push(opts.fechaHasta); i++; }

    if (opts.search && opts.search.trim()) {
      const term = `%${opts.search.trim()}%`;
      conds.push(`(
        p."primerNombre" ILIKE $${i}
        OR p."primerApellido" ILIKE $${i}
        OR p."segundoApellido" ILIKE $${i}
        OR p."contrato" ILIKE $${i}
        OR p."numeroId" ILIKE $${i}
      )`);
      params.push(term); i++;
    }

    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // Total
    const totalRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM "PAGOS_TITULARES" pt
       JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
       ${whereClause}`,
      params
    );
    const total = parseInt(totalRow?.total ?? '0', 10) || 0;

    // Página
    const limitIdx = i; const offsetIdx = i + 1;
    const rows = await queryMany<any>(
      `SELECT
         pt.*,
         p."primerNombre"    AS titular_primerNombre,
         p."primerApellido"  AS titular_primerApellido,
         p."segundoApellido" AS titular_segundoApellido,
         p."numeroId"        AS titular_numeroId,
         p."contrato"        AS titular_contrato,
         p."plataforma"      AS titular_plataforma
       FROM "PAGOS_TITULARES" pt
       JOIN "PEOPLE" p ON p."_id" = pt."idPeople"
       ${whereClause}
       ORDER BY pt."fechaPago" DESC, pt."_createdDate" DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, opts.limit, opts.offset]
    );

    return { rows: this.parseMany(rows), total };
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
   *
   * `fechaValidacion` opcional: si el cliente envía YYYY-MM-DD se usa esa
   * (TZ local del usuario), sino se usa CURRENT_DATE del server.
   */
  async validar(
    id: string,
    validadoPor: string,
    numeroFactura: string,
    fechaValidacion: string | null = null,
  ): Promise<PagoTitular | null> {
    const row = await queryOne<PagoTitular>(
      `UPDATE "PAGOS_TITULARES"
       SET "validado" = true,
           "fechaValidacion" = COALESCE($4::date, CURRENT_DATE),
           "validadoPor" = $2,
           "numeroFactura" = $3,
           "_updatedDate" = NOW()
       WHERE "_id" = $1
       RETURNING *`,
      [id, validadoPor, numeroFactura, fechaValidacion]
    );
    return this.parse(row);
  }
}

export const PagosTitularesRepository = new PagosTitularesRepositoryClass();
