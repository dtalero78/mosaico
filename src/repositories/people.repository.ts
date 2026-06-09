/**
 * People Repository
 *
 * All SQL for the PEOPLE table (~10 route handlers).
 */

import 'server-only';
import { query, queryOne, queryMany, parseJsonbFields } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@/lib/errors';
import { buildDynamicUpdate } from '@/lib/query-builder';

const JSONB_FIELDS = ['onHoldHistory', 'extensionHistory'];

const SEARCH_COLUMNS = `
  "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
  "tipoUsuario", "email", "contrato", "nivel", "step", "nivelParalelo", "stepParalelo",
  "estadoInactivo", "vigencia", "finalContrato", "_createdDate"
`;

const BENEFICIARY_COLUMNS = `
  "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
  "celular", "telefono", "estadoInactivo", "aprobacion", "nivel", "step", "_createdDate"
`;

class PeopleRepositoryClass extends BaseRepository {
  constructor() {
    super('PEOPLE', JSONB_FIELDS);
  }

  /**
   * Flexible lookup: match by _id OR numeroId
   */
  async findByIdOrNumeroId(id: string) {
    const row = await queryOne(
      `SELECT * FROM "PEOPLE" WHERE "_id" = $1 OR "numeroId" = $1`,
      [id]
    );
    return this.parse(row);
  }

  async findByIdOrNumeroIdOrThrow(id: string) {
    const row = await this.findByIdOrNumeroId(id);
    if (!row) throw new NotFoundError('Person', id);
    return row;
  }

  /**
   * Beneficiaries for a contract (titular's beneficiaries)
   */
  async findBeneficiariosByContrato(contrato: string) {
    return queryMany(
      `SELECT ${BENEFICIARY_COLUMNS}
       FROM "PEOPLE"
       WHERE "contrato" = $1 AND "tipoUsuario" = 'BENEFICIARIO'
       ORDER BY "primerNombre" ASC`,
      [contrato]
    );
  }

  /**
   * Titular for a contract
   */
  async findTitularByContrato(contrato: string) {
    return queryOne(
      `SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
              "celular", "telefono", "estadoInactivo", "aprobacion", "_createdDate"
       FROM "PEOPLE"
       WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
       LIMIT 1`,
      [contrato]
    );
  }

  /**
   * Unified search by name, numeroId, or contrato
   */
  async searchUnified(term: string, limit: number = 100) {
    const pattern = `%${term}%`;
    return queryMany(
      `SELECT ${SEARCH_COLUMNS}
       FROM "PEOPLE"
       WHERE (LOWER("primerNombre") LIKE LOWER($1)
           OR LOWER("primerApellido") LIKE LOWER($1)
           OR "numeroId" LIKE $1
           OR "contrato" LIKE $1)
       ORDER BY "primerNombre", "primerApellido"
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Search by name only
   */
  async searchByName(term: string, limit: number = 100) {
    const pattern = `%${term}%`;
    return queryMany(
      `SELECT ${SEARCH_COLUMNS}
       FROM "PEOPLE"
       WHERE (LOWER("primerNombre") LIKE LOWER($1)
           OR LOWER("segundoNombre") LIKE LOWER($1)
           OR LOWER("primerApellido") LIKE LOWER($1)
           OR LOWER("segundoApellido") LIKE LOWER($1))
       ORDER BY "primerNombre", "primerApellido"
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Beneficiarios without academic record (LEFT JOIN ACADEMICA)
   */
  async findBeneficiariosSinRegistro(filters?: { nivel?: string; contrato?: string }) {
    const conditions = [
      `p."tipoUsuario" = 'BENEFICIARIO'`,
      `a."_id" IS NULL`,
    ];
    const params: any[] = [];
    let idx = 1;

    if (filters?.nivel) {
      conditions.push(`p."nivel" = $${idx++}`);
      params.push(filters.nivel);
    }
    if (filters?.contrato) {
      conditions.push(`p."contrato" = $${idx++}`);
      params.push(filters.contrato);
    }

    return queryMany(
      `SELECT p.*
       FROM "PEOPLE" p
       LEFT JOIN "ACADEMICA" a ON p."numeroId" = a."numeroId"
       WHERE ${conditions.join(' AND ')}
       ORDER BY p."primerApellido", p."primerNombre"`,
      params
    );
  }

  /**
   * Dynamic update using field whitelist
   */
  async updateFields(id: string, body: Record<string, any>, allowedFields: string[]) {
    const built = buildDynamicUpdate('PEOPLE', body, allowedFields);
    if (!built) return null;
    built.values.push(id);
    const row = await queryOne(built.query, built.values);
    return this.parse(row);
  }

  /**
   * Update nivel/step.
   * When assigning ESS (nivel='ESS'), also stores fechaInicioESS = NOW() for auto-promotion tracking.
   */
  async updateStep(id: string, nivel: string, step: string, isParallel: boolean) {
    const [col1, col2] = isParallel
      ? ['"nivelParalelo"', '"stepParalelo"']
      : ['"nivel"', '"step"'];

    const essClause = nivel === 'ESS' ? `, "fechaInicioESS" = NOW()` : '';

    return queryOne(
      `UPDATE "PEOPLE"
       SET ${col1} = $1, ${col2} = $2${essClause}, "_updatedDate" = NOW()
       WHERE "_id" = $3
       RETURNING *`,
      [nivel, step, id]
    );
  }

  /**
   * Extend contract end date (manual extension).
   *
   * Marca el estado operativo del contrato como 'CON EXTENSION'.
   * Cuando finalContrato venza, el cron expire-contracts lo pasará a
   * 'FINALIZADA'.
   */
  async extendContract(
    id: string,
    newFinalContrato: string,
    newVigencia: number,
    extensionHistory: any[]
  ) {
    const row = await queryOne(
      `UPDATE "PEOPLE"
       SET "finalContrato" = $1::date,
           "vigencia" = $2,
           "extensionCount" = COALESCE("extensionCount", 0) + 1,
           "extensionHistory" = $3::jsonb,
           "estado" = 'CON EXTENSION',
           "_updatedDate" = NOW()
       WHERE "_id" = $4
       RETURNING *`,
      [newFinalContrato, newVigencia, JSON.stringify(extensionHistory), id]
    );
    return this.parse(row);
  }

  /**
   * Toggle estadoInactivo
   */
  async toggleStatus(id: string, inactive: boolean) {
    return queryOne(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = $1, "_updatedDate" = NOW()
       WHERE "_id" = $2
       RETURNING *`,
      [inactive, id]
    );
  }

  /**
   * Toggle estadoInactivo + persist the latest admin suspension event.
   *
   * suspenddata is overwritten with the new entry (only last record matters).
   * suspendcount is incremented only when transitioning to inactive
   * (INACTIVACION); on REACTIVACION the counter is left untouched.
   */
  async toggleStatusWithSuspendData(
    id: string,
    inactive: boolean,
    suspendData: {
      accion: 'INACTIVACION' | 'REACTIVACION';
      motivo: string;
      fecha: string;
      realizadoPor: string;
      realizadoPorNombre?: string;
    }
  ) {
    const counterClause = inactive
      ? `, "suspendcount" = COALESCE("suspendcount", 0) + 1`
      : '';
    return queryOne(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = $1,
           "suspenddata" = $2::jsonb,
           "_updatedDate" = NOW()
           ${counterClause}
       WHERE "_id" = $3
       RETURNING *`,
      [inactive, JSON.stringify(suspendData), id]
    );
  }

  /**
   * Activate OnHold
   */
  async activateOnHold(
    id: string,
    fechaOnHold: string,
    fechaFinOnHold: string,
    onHoldHistory: any[]
  ) {
    const row = await queryOne(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = true,
           "estado" = 'On Hold',
           "fechaOnHold" = $1::timestamp with time zone,
           "fechaFinOnHold" = $2::timestamp with time zone,
           "onHoldCount" = COALESCE("onHoldCount", 0) + 1,
           "onHoldHistory" = $3::jsonb,
           "_updatedDate" = NOW()
       WHERE "_id" = $4
       RETURNING *`,
      [fechaOnHold, fechaFinOnHold, JSON.stringify(onHoldHistory), id]
    );
    return this.parse(row);
  }

  /**
   * Deactivate OnHold with automatic contract extension.
   *
   * Extiende `finalContrato` por los días pausados pero NO toca
   * `extensionCount` ni `extensionHistory`: OnHold y Extensión son
   * procesos independientes con contadores separados. La traza del
   * OnHold ya está en `onHoldHistory` (escrita al activar).
   */
  async deactivateOnHold(
    id: string,
    newFinalContrato: string,
    newVigencia: number,
  ) {
    const row = await queryOne(
      `UPDATE "PEOPLE"
       SET "estadoInactivo" = false,
           "estado" = 'ACTIVA',
           "fechaOnHold" = NULL,
           "fechaFinOnHold" = NULL,
           "finalContrato" = $1::timestamp with time zone,
           "vigencia" = $2,
           "_updatedDate" = NOW()
       WHERE "_id" = $3
       RETURNING *`,
      [newFinalContrato, newVigencia, id]
    );
    return this.parse(row);
  }

  /**
   * Create a new person
   */
  async create(data: Record<string, any>) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    const row = await queryOne(
      `INSERT INTO "PEOPLE" (${columnList}, "_createdDate", "_updatedDate")
       VALUES (${placeholders}, NOW(), NOW())
       RETURNING *`,
      values
    );
    return this.parse(row);
  }

  // ── Consent helpers ──

  /**
   * Get fields needed for consent operations
   */
  async getConsentData(id: string) {
    return queryOne(
      `SELECT "_id", "numeroId", "celular", "primerNombre", "plataforma", "contrato",
              "consentimientoDeclarativo", "hashConsentimiento"
       FROM "PEOPLE" WHERE "_id" = $1`,
      [id]
    );
  }

  /**
   * Save declarative consent and hash
   */
  async saveConsent(
    id: string,
    consentJSON: string,
    hash: string,
    numeroDoc: string
  ) {
    const row = await queryOne(
      `UPDATE "PEOPLE"
       SET "consentimientoDeclarativo" = $1,
           "hashConsentimiento" = $2,
           "numeroDocumentoVerificado" = $3,
           "inicioContrato" = NOW(),
           "_updatedDate" = NOW()
       WHERE "_id" = $4
       RETURNING *`,
      [consentJSON, hash, numeroDoc, id]
    );
    return this.parse(row);
  }

  // ── Comments helpers ──

  /**
   * Get the comentarios field for a person (cast to text[] so pg returns a JS array)
   */
  async getComments(id: string) {
    return queryOne<{ comentarios: string[] | null }>(
      `SELECT COALESCE("comentarios"::text[], ARRAY[]::text[]) AS "comentarios"
       FROM "PEOPLE" WHERE "_id" = $1`,
      [id]
    );
  }

  /**
   * Append a comment JSON string to the comentarios text[] field
   */
  async appendComment(id: string, commentJson: string) {
    return queryOne(
      `UPDATE "PEOPLE"
       SET "comentarios" = array_append(COALESCE("comentarios"::text[], ARRAY[]::text[]), $1)::text,
           "_updatedDate" = NOW()
       WHERE "_id" = $2
       RETURNING "comentarios"`,
      [commentJson, id]
    );
  }

  // ── Dashboard helpers ──

  async countActive(): Promise<number> {
    // Excluye contratos de prueba (PRB-) del conteo del dashboard.
    // Sin COALESCE en el WHERE — bloquea uso de índices sobre "contrato".
    return this.count(`WHERE "estadoInactivo" = false AND ("contrato" IS NULL OR "contrato" NOT LIKE 'PRB-%')`);
  }

  async countInactive(): Promise<number> {
    return this.count(`WHERE "estadoInactivo" = true AND ("contrato" IS NULL OR "contrato" NOT LIKE 'PRB-%')`);
  }

  // ── Panel Estudiante helpers ──

  async findByEmail(email: string) {
    return this.rawQueryOne(
      `SELECT * FROM "PEOPLE" WHERE "email" = $1 LIMIT 1`,
      [email]
    );
  }

  async findBeneficiarioByNumeroId(numeroId: string) {
    return this.rawQueryOne(
      `SELECT * FROM "PEOPLE" WHERE "numeroId" = $1 AND "tipoUsuario" = 'BENEFICIARIO' LIMIT 1`,
      [numeroId]
    );
  }
}

export const PeopleRepository = new PeopleRepositoryClass();
