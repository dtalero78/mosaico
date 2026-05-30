/**
 * Academica Repository
 *
 * All SQL for the ACADEMICA table (~4 route handlers).
 */

import 'server-only';
import { queryOne, queryMany, parseJsonbFields } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { NotFoundError } from '@/lib/errors';

const JSONB_FIELDS = ['extensionHistory'];

class AcademicaRepositoryClass extends BaseRepository {
  constructor() {
    super('ACADEMICA', JSONB_FIELDS);
  }

  /**
   * Flexible lookup: match by _id, studentId, peopleId, or numeroId
   */
  async findByAnyId(id: string) {
    const row = await queryOne(
      `SELECT "_id", "studentId", "numeroId", "nivel", "step", "nivelParalelo", "stepParalelo",
              "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
              "asesor", "fechaNacimiento", "celular", "telefono", "email", "contrato",
              "fechaCreacion", "tipoUsuario", "plataforma", "usuarioId", "peopleId",
              "estadoInactivo", "fechaContrato", "finalContrato", "vigencia",
              "extensionCount", "extensionHistory", "onHoldCount"
       FROM "ACADEMICA"
       WHERE "_id" = $1 OR "studentId" = $1 OR "peopleId" = $1 OR "numeroId" = $1`,
      [id]
    );
    return this.parse(row);
  }

  async findByAnyIdOrThrow(id: string) {
    const row = await this.findByAnyId(id);
    if (!row) throw new NotFoundError('Academic record', id);
    return row;
  }

  /**
   * Find by numeroId (returns first match)
   */
  async findByNumeroId(numeroId: string) {
    const row = await queryOne(
      `SELECT * FROM "ACADEMICA" WHERE "numeroId" = $1`,
      [numeroId]
    );
    return this.parse(row);
  }

  /**
   * Find all records with the same numeroId (duplicate detection)
   */
  async findManyByNumeroId(numeroId: string) {
    return queryMany(
      `SELECT "_id", "numeroId", "primerNombre", "primerApellido", "nivel", "step"
       FROM "ACADEMICA"
       WHERE "numeroId" = $1
       ORDER BY "_createdDate" ASC`,
      [numeroId]
    );
  }

  /**
   * Find by email
   */
  async findByEmail(email: string) {
    const row = await queryOne(
      `SELECT * FROM "ACADEMICA" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
      [email]
    );
    return this.parse(row);
  }

  /**
   * Check if a student has an academic record
   */
  async existsByNumeroId(numeroId: string): Promise<boolean> {
    const row = await queryOne(
      `SELECT "_id" FROM "ACADEMICA" WHERE "numeroId" = $1 LIMIT 1`,
      [numeroId]
    );
    return row !== null;
  }

  /**
   * Student profile: ACADEMICA joined with PEOPLE
   */
  async findProfileById(id: string) {
    const row = await queryOne(
      `SELECT a."_id", a."numeroId", a."primerNombre", a."segundoNombre", a."primerApellido", a."segundoApellido",
              p."celular", p."telefono", COALESCE(a."email", p."email") AS "email", p."domicilio", p."ciudad", p."fechaNacimiento",
              p."contrato", a."fechaCreacion", p."tipoUsuario", a."plataforma",
              a."nivel", a."step", a."nivelParalelo", a."stepParalelo", p."aprobacion",
              COALESCE(p."estadoInactivo", a."estadoInactivo"::boolean) AS "estadoInactivo", p."estado", p."fechaOnHold", p."fechaFinOnHold",
              p."vigenciaOriginalPreOnHold", p."onHoldCount", p."onHoldHistory",
              p."extensionCount", p."extensionHistory", p."fechaContrato", p."finalContrato",
              COALESCE(p."vigencia"::text, a."vigencia"::text) AS "vigencia",
              p."titularId", a."asesor", a."usuarioId", p."_id" AS "peopleId", p."ingresos", p."genero",
              COALESCE(a."clave", p."clave") AS "clave",
              p."empresa", p."cargo", p."referenciaUno", p."parentezcoRefUno", p."telefonoRefUno",
              p."referenciaDos", p."parentezcoRefDos", p."telefonoRefDos",
              p."suspenddata", p."suspendcount",
              a."_createdDate", a."_updatedDate", p."documentacion"
       FROM "ACADEMICA" a
       LEFT JOIN LATERAL (
         SELECT * FROM "PEOPLE" p2
         WHERE p2."numeroId" = a."numeroId"
         ORDER BY CASE WHEN p2."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
         LIMIT 1
       ) p ON true
       WHERE a."_id" = $1`,
      [id]
    );
    if (!row) return null;
    return parseJsonbFields(row, ['onHoldHistory', 'extensionHistory']);
  }

  /**
   * Search in ACADEMICA with PEOPLE join
   */
  async searchWithPeople(term: string, limit: number = 100) {
    const pattern = `%${term}%`;
    return queryMany(
      `SELECT a."_id", a."numeroId", a."nivel", a."step", a."nivelParalelo", a."stepParalelo",
              p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
              p."tipoUsuario", p."email", p."contrato"
       FROM "ACADEMICA" a
       INNER JOIN LATERAL (
         SELECT * FROM "PEOPLE" p2
         WHERE p2."numeroId" = a."numeroId"
         ORDER BY CASE WHEN p2."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
         LIMIT 1
       ) p ON true
       WHERE (LOWER(p."primerNombre") LIKE LOWER($1)
           OR LOWER(p."primerApellido") LIKE LOWER($1)
           OR a."numeroId" LIKE $1
           OR p."contrato" LIKE $1)
       ORDER BY p."primerNombre", p."primerApellido"
       LIMIT $2`,
      [pattern, limit]
    );
  }

  /**
   * Create academic record
   */
  async create(data: Record<string, any>) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnList = columns.map((c) => `"${c}"`).join(', ');

    return queryOne(
      `INSERT INTO "ACADEMICA" (${columnList}, "_createdDate", "_updatedDate")
       VALUES (${placeholders}, NOW(), NOW())
       RETURNING *`,
      values
    );
  }

  /**
   * Update nivel/step.
   * When assigning ESS (nivel='ESS'), also stores fechaInicioESS = NOW() for auto-promotion tracking.
   */
  async updateStep(numeroId: string, nivel: string, step: string, isParallel: boolean) {
    const [col1, col2] = isParallel
      ? ['"nivelParalelo"', '"stepParalelo"']
      : ['"nivel"', '"step"'];

    const essClause = nivel === 'ESS' ? `, "fechaInicioESS" = NOW()` : '';

    return queryOne(
      `UPDATE "ACADEMICA"
       SET ${col1} = $1, ${col2} = $2${essClause}, "_updatedDate" = NOW()
       WHERE "numeroId" = $3
       RETURNING *`,
      [nivel, step, numeroId]
    );
  }

  // ── Dashboard helpers ──

  async countTotal(): Promise<number> {
    // Excluye contratos de prueba (PRB-) — sus PEOPLE quedan fuera del dashboard.
    return this.count(`WHERE NOT EXISTS (
      SELECT 1 FROM "PEOPLE" pp_prb
      WHERE pp_prb."numeroId" = "ACADEMICA"."numeroId"
        AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
    )`);
  }

  async updateClave(id: string, clave: string) {
    return queryOne(
      `UPDATE "ACADEMICA" SET "clave" = $1, "_updatedDate" = NOW() WHERE "_id" = $2 RETURNING "_id", "clave"`,
      [clave, id]
    );
  }

  /**
   * Ensure cambioStepHistory column exists (idempotent).
   */
  async ensureCambioStepHistoryColumn() {
    const { query: q } = await import('@/lib/postgres');
    await q(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "cambioStepHistory" JSONB`, []);
  }

  /**
   * Append an audit entry to ACADEMICA.cambioStepHistory.
   */
  async saveCambioStepHistory(academicaId: string, entry: Record<string, any>) {
    await this.ensureCambioStepHistoryColumn();
    const { queryOne: qOne } = await import('@/lib/postgres');
    return qOne(
      `UPDATE "ACADEMICA"
       SET "cambioStepHistory" = COALESCE("cambioStepHistory", '[]'::jsonb) || $1::jsonb,
           "_updatedDate" = NOW()
       WHERE "_id" = $2
       RETURNING "_id", "nivel", "step", "cambioStepHistory"`,
      [JSON.stringify([entry]), academicaId]
    );
  }

  /**
   * Ensure inicianivel/checkinicianivel columns exist (idempotent).
   * Called once before the first use of Inicializar Nivel.
   */
  async ensureInicializarNivelColumns() {
    const { query: q } = await import('@/lib/postgres');
    await q(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "checkinicianivel" INTEGER`, []);
    await q(`ALTER TABLE "ACADEMICA" ADD COLUMN IF NOT EXISTS "inicianivel" JSONB`, []);
  }

  /**
   * Check if inicializar nivel has already been done (checkinicianivel >= 1).
   */
  async getInicializarNivelStatus(academicaId: string): Promise<{ done: boolean; data: any }> {
    await this.ensureInicializarNivelColumns();
    const row = await queryOne(
      `SELECT "checkinicianivel", "inicianivel", "nivel", "step" FROM "ACADEMICA" WHERE "_id" = $1`,
      [academicaId]
    );
    return {
      done: !!row?.checkinicianivel && row.checkinicianivel >= 1,
      data: row,
    };
  }

  /**
   * Execute nivel reset: set step to firstStep, write audit to inicianivel, set checkinicianivel=1.
   */
  async resetNivel(academicaId: string, firstStep: string, auditData: Record<string, any>) {
    await this.ensureInicializarNivelColumns();
    return queryOne(
      `UPDATE "ACADEMICA"
       SET "step" = $1,
           "checkinicianivel" = 1,
           "inicianivel" = $2::jsonb,
           "_updatedDate" = NOW()
       WHERE "_id" = $3
       RETURNING "_id", "nivel", "step", "checkinicianivel", "inicianivel"`,
      [firstStep, JSON.stringify(auditData), academicaId]
    );
  }
}

export const AcademicaRepository = new AcademicaRepositoryClass();
