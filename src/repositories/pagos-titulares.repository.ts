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
import { buildPlataformaWhereSql, type PlataformaScope } from '@/lib/recaudos-scope';

export interface PagoTitular {
  _id: string;
  idPeople: string;
  numeroId: string | null;
  gestorRecaudo: string | null;
  plataforma: string | null;
  pagoTercero: string | null;
  idTercero: string | null;
  fechaPago: string | null;
  /** "Fecha Primer Pago" en el wizard — viene del contrato, no editable.
   *  Mantenemos el nombre legacy `fechaVencimiento` en la BD para no romper
   *  registros existentes; el wizard simplemente la renderiza con otro label. */
  fechaVencimiento: string | null;
  /** "Fecha de Reporte" — cuándo se registró el pago en el sistema
   *  (default hoy en el wizard). Independiente de `fechaPago` (cuándo
   *  pagó realmente el titular). Nullable para retrocompatibilidad. */
  fechaReporte: string | null;
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
  numeroRecibo: string | null;
  /** 'normal' | 'prejuridico' | 'juridico' | 'castigada'. Default 'normal'. */
  tipoCartera: string | null;
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
         "pagoTercero", "idTercero", "fechaPago", "fechaVencimiento", "fechaReporte",
         "plan", "vlrTotalProg", "numCuota", "cuotasTotal", "valorCuota", "valorPagado",
         "saldo", "descuento", "inscripcion", "medioPago", "numeroReferencia",
         "numeroFactura", "documentosAdjuntos", "validado", "createdBy"
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21,
         $22, $23::jsonb, $24, $25
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
        data.fechaReporte ?? null,
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
    gestorRecaudo?: string | null;
    /** Scope de plataforma del usuario logueado (filtra titulares.plataforma) */
    plataformaScope?: PlataformaScope | null;
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

    if (opts.gestorRecaudo && opts.gestorRecaudo.trim()) {
      conds.push(`pt."gestorRecaudo" = $${i}`);
      params.push(opts.gestorRecaudo.trim()); i++;
    }

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

    // Plataforma scope (multi-tenancy Recaudos) sobre titular
    if (opts.plataformaScope) {
      const scope = buildPlataformaWhereSql(opts.plataformaScope, 'p."plataforma"', i);
      if (scope.sql) {
        // Remueve el " AND " inicial porque ya estamos construyendo conds[]
        conds.push(scope.sql.replace(/^\s*AND\s+/, ''));
        params.push(...scope.params);
        i += scope.params.length;
      }
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
    // Importante: los alias deben estar entrecomillados para preservar
    // case (de lo contrario Postgres los baja a snake_case minúsculas y
    // el frontend recibe `undefined`).
    const rows = await queryMany<any>(
      `SELECT
         pt.*,
         p."primerNombre"    AS "titular_primerNombre",
         p."primerApellido"  AS "titular_primerApellido",
         p."segundoApellido" AS "titular_segundoApellido",
         p."numeroId"        AS "titular_numeroId",
         p."contrato"        AS "titular_contrato",
         p."plataforma"      AS "titular_plataforma"
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
   * Lista de titulares ASIGNADOS a gestores de recaudo (page Asignación).
   *
   * Devuelve un row por titular con agregaciones de sus pagos:
   *   - ultimaFechaPago: MAX(fechaPago) de pagos VALIDADOS con numCuota > 0
   *   - ultimaCuotaPagada: MAX(numCuota) de validados con numCuota > 0
   *   - tipoCartera: leído del registro cuota #0 (con default 'normal')
   *   - saldoActual: FINANCIEROS.saldo (texto legacy)
   *   - diaVencimiento: día del mes (1-31) extraído de FINANCIEROS.fechaPago
   *     en la zona horaria de la PLATAFORMA del titular (Chile→Santiago,
   *     Ecuador→Guayaquil, Colombia/Perú→Bogota/Lima). Mismo resultado
   *     para todos los consultores (no depende de la TZ del navegador).
   *     Si fechaPago es NULL, devuelve NULL.
   *
   * Filtros (todos opcionales):
   *   - gestorRecaudoIn: lista de USUARIOS_ROLES._id a los que se restringe
   *     el filtro p.gestorRecaudo IN (...) — viene del role-based filter
   *     calculado en el service (no del cliente).
   *   - search: ILIKE sobre nombre/apellido/contrato/numeroId
   *   - estadoCartera: filtra por tipoCartera del registro cuota #0
   *   - fechaDesde / fechaHasta: rango sobre PEOPLE.fechaContrato
   *
   * Sólo titulares con gestorRecaudo NOT NULL.
   */
  async findTitularesAsignados(opts: {
    gestorRecaudoIn: string[];           // [] = no filtro adicional (admin); undefined invalida
    search?: string | null;
    // Acepta vocabulario nuevo (normal/prejuridico/ultimopago/penalidad) y legacy (juridico/castigada).
    estadoCartera?: string | null;
    fechaDesde?: string | null;
    fechaHasta?: string | null;
    /** Scope de plataforma del usuario logueado (filtra titulares.plataforma) */
    plataformaScope?: PlataformaScope | null;
    limit: number;
    offset: number;
  }): Promise<{ rows: any[]; total: number }> {
    const conds: string[] = [
      `p."tipoUsuario" = 'TITULAR'`,
      `p."gestorRecaudo" IS NOT NULL`,
      `p."gestorRecaudo" <> ''`,
    ];
    const params: any[] = [];
    let i = 1;

    // Plataforma scope (multi-tenancy Recaudos) sobre titular
    if (opts.plataformaScope) {
      const scope = buildPlataformaWhereSql(opts.plataformaScope, 'p."plataforma"', i);
      if (scope.sql) {
        conds.push(scope.sql.replace(/^\s*AND\s+/, ''));
        params.push(...scope.params);
        i += scope.params.length;
      }
    }

    // Filtro role-based: si el caller pasa un array no vacío, restringe.
    // Si pasa array vacío → no restringe (caso admin/super_admin).
    if (Array.isArray(opts.gestorRecaudoIn) && opts.gestorRecaudoIn.length > 0) {
      conds.push(`p."gestorRecaudo" = ANY($${i}::text[])`);
      params.push(opts.gestorRecaudoIn);
      i++;
    }

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

    if (opts.fechaDesde) { conds.push(`p."fechaContrato" >= $${i}::date`); params.push(opts.fechaDesde); i++; }
    if (opts.fechaHasta) { conds.push(`p."fechaContrato" <= $${i}::date`); params.push(opts.fechaHasta); i++; }

    // Reglas de filtro por tipoCartera (mayo 2026):
    //   - 'normal'      → todos (sin restricción de mes)
    //   - 'prejuridico' → todos (sin restricción de mes)
    //   - 'ultimopago'  → SÓLO los del mes corriente (en TZ America/Bogota,
    //     tomada como referencia de operación del equipo de recaudo)
    //   - 'penalidad'   → SÓLO los del mes corriente (idem)
    //   - sin filtro    → unión: todos normal/prejuridico + ultimopago/penalidad
    //     del mes corriente. Esto evita acumular casos viejos de ultimopago/
    //     penalidad y deja al asistente concentrarse en los activos.
    //
    // "Del mes corriente" se evalúa con la fecha del último cambio a ese
    // tipoCartera (tomado de la última entry de `tipoCarteraHistory` cuyo
    // `estadoNuevo` coincide con el `tipoCartera` actual; fallback a
    // `c0."_updatedDate"` si no hay history).
    const monthFilterSql = (alias: string) => `
      COALESCE(
        (SELECT MAX((entry->>'fecha')::timestamptz)
         FROM jsonb_array_elements(${alias}."tipoCarteraHistory") AS entry
         WHERE entry->>'estadoNuevo' = ${alias}."tipoCartera"),
        ${alias}."_updatedDate"
      ) >= date_trunc('month', NOW() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
    `;
    const TRANSITORIOS = `('ultimopago', 'penalidad')`;
    const ESTABLES     = `('normal', 'prejuridico')`;

    if (opts.estadoCartera) {
      const ec = String(opts.estadoCartera).toLowerCase();
      conds.push(`COALESCE(c0."tipoCartera", 'normal') = $${i}`);
      params.push(ec);
      i++;
      if (ec === 'ultimopago' || ec === 'penalidad') {
        // Filtro adicional: el cambio a este estado debe ser del mes corriente
        conds.push(monthFilterSql('c0'));
      }
    } else {
      // Sin filtro explícito → unión de estables (sin restricción) +
      // transitorios (sólo del mes). Legacy values (juridico/castigada)
      // siguen visibles vía el último OR.
      conds.push(`(
        COALESCE(c0."tipoCartera", 'normal') IN ${ESTABLES}
        OR (
          c0."tipoCartera" IN ${TRANSITORIOS}
          AND ${monthFilterSql('c0')}
        )
        OR (
          c0."tipoCartera" IS NOT NULL
          AND c0."tipoCartera" NOT IN ${ESTABLES}
          AND c0."tipoCartera" NOT IN ${TRANSITORIOS}
        )
      )`);
    }

    const whereClause = `WHERE ${conds.join(' AND ')}`;

    // Total
    const totalRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM "PEOPLE" p
       LEFT JOIN LATERAL (
         SELECT pt0."tipoCartera", pt0."tipoCarteraHistory", pt0."_updatedDate"
         FROM "PAGOS_TITULARES" pt0
         WHERE pt0."idPeople" = p."_id" AND pt0."numCuota" = 0
         LIMIT 1
       ) c0 ON true
       ${whereClause}`,
      params
    );
    const total = parseInt(totalRow?.total ?? '0', 10) || 0;

    // Página
    const limitIdx = i; const offsetIdx = i + 1;
    const rows = await queryMany<any>(
      `SELECT
         p."_id"                                 AS "_id",
         p."primerNombre"                        AS "primerNombre",
         p."primerApellido"                      AS "primerApellido",
         p."segundoApellido"                     AS "segundoApellido",
         p."numeroId"                            AS "numeroId",
         p."contrato"                            AS "contrato",
         p."fechaContrato"                       AS "fechaContrato",
         p."plataforma"                          AS "plataforma",
         p."gestorRecaudo"                       AS "gestorRecaudo",
         p."estadoInactivo"                      AS "estadoInactivo",
         p."aprobacion"                          AS "aprobacion",
         p."marcaOpcional"                       AS "marcaOpcional",
         f."saldo"                               AS "saldoActual",
         COALESCE(c0."tipoCartera", 'normal')    AS "tipoCartera",
         agg."ultimaFechaPago"                   AS "ultimaFechaPago",
         agg."ultimaCuotaPagada"                 AS "ultimaCuotaPagada",
         f."fechaPago"                           AS "fechaPrimerPago"
       FROM "PEOPLE" p
       LEFT JOIN "FINANCIEROS" f ON f."contrato" = p."contrato"
       LEFT JOIN LATERAL (
         SELECT pt0."tipoCartera", pt0."tipoCarteraHistory", pt0."_updatedDate"
         FROM "PAGOS_TITULARES" pt0
         WHERE pt0."idPeople" = p."_id" AND pt0."numCuota" = 0
         LIMIT 1
       ) c0 ON true
       LEFT JOIN LATERAL (
         SELECT
           MAX(pt1."fechaPago")  AS "ultimaFechaPago",
           MAX(pt1."numCuota")   AS "ultimaCuotaPagada"
         FROM "PAGOS_TITULARES" pt1
         WHERE pt1."idPeople" = p."_id"
           AND pt1."validado" = true
           AND pt1."numCuota" > 0
       ) agg ON true
       ${whereClause}
       ORDER BY p."fechaContrato" DESC NULLS LAST, p."primerApellido" ASC NULLS LAST
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, opts.limit, opts.offset]
    );

    return { rows, total };
  }

  /**
   * Asigna numeroRecibo si no tiene, en formato LGS-####.
   * Numeración global atómica via MAX+1 (mismo patrón que contracts).
   * Si ya tiene numeroRecibo lo conserva (idempotente).
   * Retorna el numeroRecibo final.
   */
  async assignNumeroRecibo(id: string): Promise<string> {
    const existing = await queryOne<{ numeroRecibo: string | null }>(
      `SELECT "numeroRecibo" FROM "PAGOS_TITULARES" WHERE "_id" = $1`,
      [id]
    );
    if (existing?.numeroRecibo) return existing.numeroRecibo;

    const maxRow = await queryOne<{ max_num: number | null }>(
      `SELECT MAX(CAST(SUBSTRING("numeroRecibo" FROM 5) AS INTEGER)) AS max_num
       FROM "PAGOS_TITULARES"
       WHERE "numeroRecibo" LIKE 'LGS-%'
         AND SUBSTRING("numeroRecibo" FROM 5) ~ '^[0-9]+$'`
    );
    const next = (Number(maxRow?.max_num ?? 0) + 1).toString().padStart(4, '0');
    const numeroRecibo = `LGS-${next}`;

    await queryOne(
      `UPDATE "PAGOS_TITULARES"
       SET "numeroRecibo" = $2, "_updatedDate" = NOW()
       WHERE "_id" = $1 AND "numeroRecibo" IS NULL
       RETURNING "_id"`,
      [id, numeroRecibo]
    );
    // Re-leer por si dos requests concurrentes ganaron uno solo
    const after = await queryOne<{ numeroRecibo: string }>(
      `SELECT "numeroRecibo" FROM "PAGOS_TITULARES" WHERE "_id" = $1`,
      [id]
    );
    return after?.numeroRecibo ?? numeroRecibo;
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
