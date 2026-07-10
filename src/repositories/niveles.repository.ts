/**
 * Niveles Repository
 *
 * All SQL for NIVELES and STEP_OVERRIDES tables.
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';

const NIVELES_JSONB = ['material', 'clubs', 'steps', 'materiales'];

// ── NIVELES ──

class NivelesRepositoryClass extends BaseRepository {
  constructor() {
    super('NIVELES', NIVELES_JSONB);
  }

  /**
   * Get all levels ordered
   */
  async findAll() {
    const rows = await queryMany(
      `SELECT "_id", "code", "step", "description", "esParalelo", "material",
              "clubs", "steps", "materiales", "orden", "videoUrl", "curso", "_createdDate", "_updatedDate"
       FROM "NIVELES"
       ORDER BY "orden" ASC NULLS LAST, "code" ASC`
    );
    return this.parseMany(rows);
  }

  /**
   * Get all steps for a specific nivel
   */
  async findByCode(code: string) {
    const rows = await queryMany(
      `SELECT "_id", "code", "step", "description", "esParalelo", "material",
              "clubs", "steps", "materiales", "materialUsuario", "orden", "videoUrl", "_createdDate", "_updatedDate"
       FROM "NIVELES"
       WHERE "code" = $1
       ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
      [code]
    );
    return this.parseMany(rows);
  }

  /**
   * Get videoUrl for a specific nivel + step combination
   */
  async findVideoByNivelAndStep(nivel: string, step: string) {
    return queryOne<{ videoUrl: string | null }>(
      `SELECT "videoUrl" FROM "NIVELES"
       WHERE "code" = $1 AND "step" = $2
       LIMIT 1`,
      [nivel, step]
    );
  }

  /**
   * Lookup nivel/step by step name (for student step changes)
   */
  async findByStepName(stepName: string) {
    return queryOne<{ code: string; step: string; esParalelo: boolean }>(
      `SELECT "code", "step", "esParalelo"
       FROM "NIVELES"
       WHERE "step" = $1
       LIMIT 1`,
      [stepName]
    );
  }

  /**
   * Get nivel info with steps list
   */
  async getStepsForNivel(code: string) {
    return queryMany(
      `SELECT "code", "step", "steps", "esParalelo", "clubs", "description"
       FROM "NIVELES"
       WHERE "code" = $1
       ORDER BY "step"`,
      [code]
    );
  }

  /**
   * Get step content for complementary activity question generation
   */
  async findContenidoByNivelAndStep(nivel: string, step: string): Promise<string | null> {
    const row = await queryOne<{ contenido: string | null }>(
      `SELECT "contenido" FROM "NIVELES"
       WHERE "code" = $1 AND "step" = $2
       LIMIT 1`,
      [nivel, step]
    );
    return row?.contenido ?? null;
  }

  /**
   * Get the evaluation mode + manual questions for a nivel(code)+step (Fase 3).
   * `evaluacionModo`='MANUAL' → serve `preguntasManual` (auto-graded, no OpenAI);
   * 'IA' (default) → generate from `contenido`.
   */
  async findEvaluacionByNivelAndStep(
    nivel: string,
    step: string
  ): Promise<{ evaluacionModo: string; preguntasManual: any[] }> {
    const row = await queryOne<{ evaluacionModo: string | null; preguntasManual: any }>(
      `SELECT "evaluacionModo", "preguntasManual" FROM "NIVELES"
       WHERE "code" = $1 AND "step" = $2
       LIMIT 1`,
      [nivel, step]
    );
    let preguntas: any[] = [];
    const raw = row?.preguntasManual;
    if (Array.isArray(raw)) preguntas = raw;
    else if (typeof raw === 'string') { try { preguntas = JSON.parse(raw); } catch { preguntas = []; } }
    return {
      evaluacionModo: (row?.evaluacionModo || 'IA').toUpperCase(),
      preguntasManual: Array.isArray(preguntas) ? preguntas : [],
    };
  }

  /**
   * Get every step of a nivel with its `contenido`, ordered numerically by step.
   *
   * Used by the Jump tutor: a Jump evaluates the WHOLE level, so the bot needs
   * the aggregated content of all steps (e.g. BN1 → Step 1..5), not just the
   * jump step. Steps without contenido are returned with `null` so the caller
   * can decide how to render them.
   */
  async findStepsContenidoByNivel(
    nivel: string
  ): Promise<Array<{ step: string; description: string | null; contenido: string | null }>> {
    return queryMany<{ step: string; description: string | null; contenido: string | null }>(
      `SELECT "step", "description", "contenido"
       FROM "NIVELES"
       WHERE "code" = $1
       ORDER BY NULLIF(REGEXP_REPLACE("step", '\\D', '', 'g'), '')::int ASC NULLS LAST, "step" ASC`,
      [nivel]
    );
  }
}

// ── STEP_OVERRIDES ──

class StepOverridesRepositoryClass extends BaseRepository {
  constructor() {
    super('STEP_OVERRIDES');
  }

  /**
   * Get all ACTIVE overrides for a student (isCompleted IS NOT NULL).
   * Los soft-deleted (isCompleted=NULL) se ignoran por defecto — su historial
   * sigue persistido pero ya no decide aprobación de step.
   * Para ver TODO incluyendo soft-deleted con history usar findAllByStudentId.
   */
  async findByStudentId(studentId: string) {
    return queryMany(
      `SELECT * FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "isCompleted" IS NOT NULL
       ORDER BY "step", "_createdDate" DESC`,
      [studentId]
    );
  }

  /**
   * Get ALL overrides for a student incluyendo soft-deleted (con history).
   * Para auditoría / visor de histórico — no para decidir step completion.
   */
  async findAllByStudentId(studentId: string) {
    return queryMany(
      `SELECT * FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1
       ORDER BY "step", "_createdDate" DESC`,
      [studentId]
    );
  }

  /**
   * Get ACTIVE overrides for a specific nivel.
   */
  async findByStudentAndNivel(studentId: string, nivel: string) {
    return queryMany<{ step: string; isCompleted: boolean }>(
      `SELECT "step", "isCompleted"
       FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "nivel" = $2 AND "isCompleted" IS NOT NULL`,
      [studentId, nivel]
    );
  }

  /**
   * Find a specific override (any state, incl. soft-deleted, para que upsert
   * pueda reactivar una fila previamente quitada en lugar de duplicar).
   */
  async findByStudentAndStep(studentId: string, step: string) {
    return queryOne<{ _id: string; isCompleted: boolean | null }>(
      `SELECT "_id", "isCompleted" FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "step" = $2`,
      [studentId, step]
    );
  }

  /**
   * Create a step override
   */
  async create(data: {
    _id: string;
    studentId: string;
    nivel: string;
    step: string;
    isCompleted: boolean;
  }) {
    return queryOne(
      `INSERT INTO "STEP_OVERRIDES" (
        "_id", "studentId", "nivel", "step", "isCompleted",
        "_createdDate", "_updatedDate"
      ) VALUES (
        $1, $2, $3, $4, $5, NOW(), NOW()
      )
      RETURNING *`,
      [data._id, data.studentId, data.nivel, data.step, data.isCompleted]
    );
  }

  /**
   * Update an existing override
   */
  async update(id: string, isCompleted: boolean) {
    return queryOne(
      `UPDATE "STEP_OVERRIDES"
       SET "isCompleted" = $1,
           "_updatedDate" = NOW()
       WHERE "_id" = $2
       RETURNING *`,
      [isCompleted, id]
    );
  }

  /**
   * Delete a step override (LEGACY — hace borrado físico; el nuevo flujo
   * con auditoría usa upsertWithHistory(..., isCompleted=null) para soft-delete).
   */
  async deleteByStudentAndStep(studentId: string, step: string) {
    const result = await query(
      `DELETE FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "step" = $2
       RETURNING "_id"`,
      [studentId, step]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Upsert auditable de un override.
   *
   * - isCompleted=true  → "MARCADO_COMPLETO" (step aprobado por admin).
   * - isCompleted=false → "MARCADO_INCOMPLETO" (step forzado a incompleto).
   * - isCompleted=null  → "OVERRIDE_QUITADO" (soft-delete: la fila persiste
   *   con isCompleted=NULL para que las lecturas la ignoren, pero el
   *   historial queda guardado).
   *
   * En todos los casos se append-ea una entry a "notaoverrideHistory" con
   * motivo + actor + fecha + before/after. La regla de motivo obligatorio
   * la valida el endpoint (acá asumimos que ya viene validado).
   *
   * Devuelve la fila resultante.
   */
  async upsertWithHistory(input: {
    _id: string;
    studentId: string;
    nivel: string;
    step: string;
    isCompleted: boolean | null;
    motivo: string;
    realizadoPor: string;        // session.user.email
    realizadoPorNombre?: string; // session.user.name
  }) {
    const existing = await queryOne<{ _id: string; isCompleted: boolean | null }>(
      `SELECT "_id", "isCompleted" FROM "STEP_OVERRIDES"
       WHERE "studentId" = $1 AND "step" = $2`,
      [input.studentId, input.step]
    );

    const isCompletedBefore = existing?.isCompleted ?? null;
    const isCompletedAfter  = input.isCompleted;
    const accion =
      isCompletedAfter === true  ? 'MARCADO_COMPLETO' :
      isCompletedAfter === false ? 'MARCADO_INCOMPLETO' :
                                   'OVERRIDE_QUITADO';

    const entry = {
      fecha: new Date().toISOString(),
      accion,
      isCompletedBefore,
      isCompletedAfter,
      motivo: input.motivo,
      realizadoPor: input.realizadoPor,
      realizadoPorNombre: input.realizadoPorNombre ?? null,
    };
    const entryJson = JSON.stringify(entry);

    if (existing) {
      return queryOne(
        `UPDATE "STEP_OVERRIDES"
         SET "isCompleted" = $1,
             "notaoverrideHistory" = COALESCE("notaoverrideHistory", '[]'::jsonb) || $2::jsonb,
             "_updatedDate" = NOW()
         WHERE "_id" = $3
         RETURNING *`,
        [input.isCompleted, entryJson, existing._id]
      );
    }

    // No existe — solo crear si hay un override real (true/false). Si llaman
    // con null sobre nada, no-op (no tiene sentido un soft-delete de nada).
    if (input.isCompleted === null) return null;

    return queryOne(
      `INSERT INTO "STEP_OVERRIDES" (
        "_id", "studentId", "nivel", "step", "isCompleted",
        "notaoverrideHistory", "_createdDate", "_updatedDate"
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW()
      )
      RETURNING *`,
      [input._id, input.studentId, input.nivel, input.step, input.isCompleted, '[' + entryJson + ']']
    );
  }
}

export const NivelesRepository = new NivelesRepositoryClass();
export const StepOverridesRepository = new StepOverridesRepositoryClass();
