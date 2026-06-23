/**
 * DBMOSAICO Repository - Dynamic Database Access
 *
 * Provides raw SQL access to any table dynamically.
 * Uses information_schema for table/column introspection.
 * Does NOT extend BaseRepository since table name is a parameter.
 *
 * IMPORTANT: Table and column names must be validated by the service layer
 * before calling these methods. This repository trusts that names are safe
 * to interpolate into SQL.
 */

import 'server-only';
import { query, queryOne, queryMany } from '@/lib/postgres';

// ── Types ──────────────────────────────────────────────────────────

export interface ColumnMeta {
  name: string;
  type: string;       // simplified: text, number, boolean, date, jsonb, unknown
  pgType: string;     // udt_name from information_schema
  nullable: boolean;
  defaultValue: string | null;
  maxLength: number | null;
  isPrimaryKey: boolean;
}

// ── Schema cache ───────────────────────────────────────────────────

const schemaCache = new Map<string, { columns: ColumnMeta[]; timestamp: number }>();
const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedSchema(table: string): ColumnMeta[] | null {
  const entry = schemaCache.get(table);
  if (entry && Date.now() - entry.timestamp < SCHEMA_CACHE_TTL) {
    return entry.columns;
  }
  return null;
}

function setCachedSchema(table: string, columns: ColumnMeta[]): void {
  schemaCache.set(table, { columns, timestamp: Date.now() });
}

// ── Helpers ────────────────────────────────────────────────────────

function mapPgTypeToSimple(udtName: string): string {
  if (['varchar', 'text', 'char', 'bpchar', 'name', 'uuid'].includes(udtName)) return 'text';
  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'serial', 'bigserial'].includes(udtName)) return 'number';
  if (['bool'].includes(udtName)) return 'boolean';
  if (['timestamp', 'timestamptz', 'date', 'time', 'timetz'].includes(udtName)) return 'date';
  if (['jsonb', 'json'].includes(udtName)) return 'jsonb';
  return 'unknown';
}

// ── Repository ─────────────────────────────────────────────────────

class DbmosaicoRepositoryClass {

  /**
   * List all base tables in the public schema
   */
  async listTables(): Promise<string[]> {
    const rows = await queryMany<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return rows.map(r => r.table_name);
  }

  /**
   * Get column metadata for a table
   */
  async getTableSchema(table: string): Promise<ColumnMeta[]> {
    const cached = getCachedSchema(table);
    if (cached) return cached;

    const rows = await queryMany<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      is_primary_key: boolean;
    }>(
      `SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = $1
          AND tc.table_schema = 'public'
          AND tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.column_name = c.column_name
      WHERE c.table_name = $1
        AND c.table_schema = 'public'
      ORDER BY c.ordinal_position`,
      [table]
    );

    const columns: ColumnMeta[] = rows.map(r => ({
      name: r.column_name,
      type: mapPgTypeToSimple(r.udt_name),
      pgType: r.udt_name,
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      maxLength: r.character_maximum_length,
      isPrimaryKey: r.is_primary_key,
    }));

    setCachedSchema(table, columns);
    return columns;
  }

  /**
   * Get approximate or exact row count for a table
   */
  async getRowCount(table: string): Promise<number> {
    const result = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM "${table}"`
    );
    return parseInt(result?.count || '0', 10);
  }

  /**
   * Read rows with dynamic WHERE, ORDER BY, and pagination
   */
  async readRows(
    table: string,
    whereClause: string,
    whereValues: any[],
    sortCol: string,
    sortDir: 'ASC' | 'DESC',
    limit: number,
    offset: number
  ): Promise<any[]> {
    const paramIdx = whereValues.length + 1;

    // Special case: USUARIOS_ROLES gets a LEFT JOIN with ACADEMICA to show academicaId
    if (table === 'USUARIOS_ROLES') {
      const wrappedWhere = whereClause
        ? `WHERE ${whereClause.replace(/"(\w+)"/g, 'ur."$1"')}`
        : '';
      const orderRef = sortCol === 'academicaId' ? '"academicaId"' : `ur."${sortCol}"`;
      const sql = `SELECT ur.*, a."_id" AS "academicaId"
        FROM "USUARIOS_ROLES" ur
        LEFT JOIN (
          SELECT DISTINCT ON (LOWER("email")) "_id", "email"
          FROM "ACADEMICA"
          ORDER BY LOWER("email"), "_id"
        ) a ON LOWER(a."email") = LOWER(ur."email")
        ${wrappedWhere}
        ORDER BY ${orderRef} ${sortDir} NULLS LAST
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

      return queryMany(sql, [...whereValues, limit, offset]);
    }

    const sql = `SELECT * FROM "${table}"
      ${whereClause ? `WHERE ${whereClause}` : ''}
      ORDER BY "${sortCol}" ${sortDir} NULLS LAST
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

    return queryMany(sql, [...whereValues, limit, offset]);
  }

  /**
   * Count rows matching a dynamic WHERE clause
   */
  async countFilteredRows(
    table: string,
    whereClause: string,
    whereValues: any[]
  ): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM "${table}"
      ${whereClause ? `WHERE ${whereClause}` : ''}`;

    const result = await queryOne<{ count: string }>(sql, whereValues);
    return parseInt(result?.count || '0', 10);
  }

  /**
   * Insert a new row with dynamic columns
   */
  async insertRow(
    table: string,
    columns: string[],
    values: any[]
  ): Promise<any> {
    const colList = columns.map(c => `"${c}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `INSERT INTO "${table}" (${colList})
      VALUES (${placeholders})
      RETURNING *`;

    return queryOne(sql, values);
  }

  /**
   * Update a single cell by row ID
   */
  async updateCell(
    table: string,
    rowId: string,
    column: string,
    value: any,
    hasUpdatedDateCol: boolean
  ): Promise<any> {
    let sql: string;
    let params: any[];

    if (hasUpdatedDateCol) {
      sql = `UPDATE "${table}"
        SET "${column}" = $1, "_updatedDate" = NOW()
        WHERE "_id" = $2
        RETURNING *`;
      params = [value, rowId];
    } else {
      sql = `UPDATE "${table}"
        SET "${column}" = $1
        WHERE "_id" = $2
        RETURNING *`;
      params = [value, rowId];
    }

    return queryOne(sql, params);
  }

  /**
   * Delete rows by IDs
   */
  async deleteRows(table: string, ids: string[]): Promise<number> {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `DELETE FROM "${table}" WHERE "_id" IN (${placeholders})`;
    const result = await query(sql, ids);
    return result.rowCount ?? 0;
  }
}

export const DbmosaicoRepository = new DbmosaicoRepositoryClass();
