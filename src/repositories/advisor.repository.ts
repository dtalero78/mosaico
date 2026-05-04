/**
 * Advisor Repository
 *
 * All SQL for the ADVISORS table.
 */

import 'server-only';
import { queryOne, queryMany } from '@/lib/postgres';
import { BaseRepository } from './base.repository';
import { buildDynamicUpdate } from '@/lib/query-builder';

const ADVISOR_COLUMNS = `
  "_id", "email", "primerNombre", "primerApellido", "nombreCompleto",
  "pais", "zoom", "activo", "fotoAdvisor", "domicilioadvisor", "fechaNacimiento", "_createdDate", "_updatedDate"
`;

class AdvisorRepositoryClass extends BaseRepository {
  constructor() {
    super('ADVISORS');
  }

  /**
   * Get all advisors, optionally including inactive ones
   */
  async findAll(includeInactive: boolean = false) {
    const whereClause = includeInactive
      ? ''
      : 'WHERE "activo" = true OR "activo" IS NULL';

    return queryMany(
      `SELECT ${ADVISOR_COLUMNS}
       FROM "ADVISORS"
       ${whereClause}
       ORDER BY "nombreCompleto" ASC NULLS LAST`
    );
  }

  /**
   * Find advisor by email
   */
  async findByEmail(email: string) {
    return queryOne(
      `SELECT ${ADVISOR_COLUMNS} FROM "ADVISORS" WHERE "email" = $1`,
      [email]
    );
  }

  /**
   * Find advisor by _id or email (for flexible lookups from booking data)
   */
  async findByIdOrEmail(idOrEmail: string) {
    return queryOne(
      `SELECT ${ADVISOR_COLUMNS} FROM "ADVISORS" WHERE "_id" = $1 OR "email" = $1`,
      [idOrEmail]
    );
  }

  /**
   * Get advisor name by ID (for display purposes)
   */
  async getNameById(id: string): Promise<string | null> {
    const row = await queryOne<{ nombreCompleto: string }>(
      `SELECT "nombreCompleto" FROM "ADVISORS" WHERE "_id" = $1`,
      [id]
    );
    return row?.nombreCompleto ?? null;
  }

  /**
   * Create a new advisor
   */
  async create(data: {
    _id: string;
    primerNombre: string;
    primerApellido: string;
    nombreCompleto: string;
    email: string;
    zoom?: string;
    telefono?: string;
    pais?: string;
    domicilio?: string;
    fotoAdvisor?: string;
  }) {
    return queryOne(
      `INSERT INTO "ADVISORS" (
        "_id", "primerNombre", "primerApellido", "nombreCompleto",
        "email", "zoom", "telefono", "pais", "domicilioadvisor", "fotoAdvisor", "activo",
        "_createdDate", "_updatedDate"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10, true,
        NOW(), NOW()
      )
      RETURNING *`,
      [
        data._id, data.primerNombre, data.primerApellido, data.nombreCompleto,
        data.email, data.zoom || null, data.telefono || null, data.pais || null,
        data.domicilio || null, data.fotoAdvisor || null,
      ]
    );
  }
  /**
   * Update allowed fields on an advisor record
   */
  async updateFields(id: string, body: Record<string, any>, allowedFields: string[]) {
    const built = buildDynamicUpdate('ADVISORS', body, allowedFields);
    if (!built) return null;
    built.values.push(id);
    const row = await queryOne(built.query, built.values);
    return row;
  }
}

export const AdvisorRepository = new AdvisorRepositoryClass();
