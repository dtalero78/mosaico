/**
 * PostgreSQL Database Client
 * Connection pooling and query utilities for LGS Admin Panel
 *
 * IMPORTANT: All PostgreSQL table/column names use camelCase with double quotes
 * Example: SELECT "primerNombre" FROM "PEOPLE" WHERE "numeroId" = $1
 *
 * SERVER-ONLY: This module must only be imported in server-side code
 */

import 'server-only';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// Connection pool configuration
// Supports both DATABASE_URL (Digital Ocean) and individual POSTGRES_* variables
// Parse DATABASE_URL and force SSL settings for Digital Ocean
const getDatabaseConfig = () => {
  if (process.env.DATABASE_URL) {
    // Remove sslmode from URL to prevent pg from overriding our SSL config
    const urlWithoutSslMode = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, '');
    return {
      connectionString: urlWithoutSslMode,
      // BD basic (db-s-1vcpu-1gb) tiene ~22 max_connections. Cada instancia
      // de Next.js en DO con max=25 puede saturarlo si hay 2+ replicas.
      // Bajamos a 8 → margen para ~2 replicas + admin tools + scripts.
      max: 8,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false,
      },
    };
  }
  return null;
};

const poolConfig = getDatabaseConfig() || {
  connectionString: undefined,
  max: 8,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false },
};

// Fallback to individual variables if no DATABASE_URL
if (!process.env.DATABASE_URL) {
  Object.assign(poolConfig, {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'lgs_admin',
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

// Reuse pool across hot reloads in development (prevents "too many clients" errors)
const globalForPg = globalThis as unknown as { _pgPool?: Pool };
const pool = globalForPg._pgPool ?? new Pool(poolConfig);
if (process.env.NODE_ENV !== 'production') {
  globalForPg._pgPool = pool;
}

// Resolve database name for logging
const _resolvedDbName = (() => {
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      return `${url.pathname.replace('/', '')} @ ${url.hostname}`;
    } catch { return 'DATABASE_URL (parse error)'; }
  }
  const h = process.env.POSTGRES_HOST || 'localhost';
  const db = process.env.POSTGRES_DB || 'lgs_admin';
  return `${db} @ ${h}`;
})();

// Startup banner
console.log('\n╔══════════════════════════════════════════════════════╗');
console.log(`║  🐘 POSTGRESQL: ${_resolvedDbName.padEnd(37)}║`);
console.log('╚══════════════════════════════════════════════════════╝\n');

// Handle pool errors
pool.on('error', (err: any) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err);
  process.exit(-1);
});

/**
 * Execute a SQL query with optional parameters
 * @param text SQL query string (use $1, $2, etc. for parameters)
 * @param params Array of parameter values
 * @returns Query result
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();

  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    // Log slow queries (> 1 second)
    if (duration > 1000) {
      console.warn(`⚠️ [DB: ${_resolvedDbName}] Slow query (${duration}ms):`, {
        query: text.substring(0, 100) + '...',
        rows: result.rowCount,
      });
    } else {
      console.log(`🐘 [DB: ${_resolvedDbName}] ${duration}ms | ${result.rowCount} rows | ${text.substring(0, 80).replace(/\s+/g, ' ').trim()}`);
    }

    return result;
  } catch (error: any) {
    console.error(`❌ [DB: ${_resolvedDbName}] Query error:`, {
      query: text.substring(0, 100) + '...',
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * Remember to call client.release() when done
 */
export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

/**
 * Execute multiple queries in a transaction
 * Automatically handles BEGIN, COMMIT, and ROLLBACK
 *
 * @param callback Function that receives a client and executes queries
 * @returns Result of the callback function
 *
 * @example
 * await transaction(async (client) => {
 *   await client.query('INSERT INTO "PEOPLE" ...');
 *   await client.query('INSERT INTO "ACADEMICA" ...');
 *   return { success: true };
 * });
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🔄 Transaction started');

    const result = await callback(client);

    await client.query('COMMIT');
    console.log('✅ Transaction committed');

    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Transaction rolled back:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return the first row
 * Returns null if no rows found
 */
export async function queryOne<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Execute a query and return all rows
 */
export async function queryMany<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT NOW() as now, version() as version');
    console.log('✅ PostgreSQL connection successful:', {
      time: result.rows[0].now,
      version: result.rows[0].version.substring(0, 50) + '...',
    });
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
}

/**
 * Close all connections in the pool
 * Call this when shutting down the application
 */
export async function closePool(): Promise<void> {
  await pool.end();
  console.log('🔌 PostgreSQL pool closed');
}

/**
 * Helper: Build UPSERT query for migration scripts
 *
 * @param tableName Table name (with quotes: "PEOPLE")
 * @param data Object with column names as keys
 * @param conflictColumn Column to check for conflicts (usually "_id")
 * @returns { query, values } ready for pool.query()
 *
 * @example
 * const { query, values } = buildUpsert('"PEOPLE"', personData, '"_id"');
 * await pool.query(query, values);
 */
export function buildUpsert(
  tableName: string,
  data: Record<string, any>,
  conflictColumn: string = '"_id"'
): { query: string; values: any[] } {
  const columns = Object.keys(data);
  const values = Object.values(data);

  // Build column list: "col1", "col2", "col3"
  const columnList = columns.map(col => `"${col}"`).join(', ');

  // Build placeholders: $1, $2, $3
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

  // Build update list: "col1" = EXCLUDED."col1", "col2" = EXCLUDED."col2"
  const updateList = columns
    .filter(col => col !== conflictColumn.replace(/"/g, '')) // Don't update conflict column
    .map(col => `"${col}" = EXCLUDED."${col}"`)
    .join(', ');

  const query = `
    INSERT INTO ${tableName} (${columnList})
    VALUES (${placeholders})
    ON CONFLICT (${conflictColumn}) DO UPDATE SET
      ${updateList}
  `;

  return { query, values };
}

/**
 * Helper: Parse JSONB fields from query results
 * PostgreSQL returns JSONB as strings, this parses them back to objects
 *
 * @param row Query result row
 * @param jsonbFields Array of field names that are JSONB
 * @returns Row with parsed JSONB fields
 *
 * @example
 * const student = await queryOne('SELECT * FROM "PEOPLE" WHERE "_id" = $1', [id]);
 * return parseJsonbFields(student, ['onHoldHistory', 'extensionHistory']);
 */
export function parseJsonbFields<T extends Record<string, any>>(
  row: T | null,
  jsonbFields: string[]
): T | null {
  if (!row) return null;

  const parsed: any = { ...row };

  for (const field of jsonbFields) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try {
        parsed[field] = JSON.parse(parsed[field]);
      } catch (error) {
        console.warn(`⚠️ Failed to parse JSONB field "${field}":`, error);
        parsed[field] = [];
      }
    }
  }

  return parsed as T;
}

/**
 * Helper: Stringify objects for JSONB insertion
 *
 * @param data Object with potential JSONB fields
 * @param jsonbFields Array of field names that should be JSONB
 * @returns Data with stringified JSONB fields
 *
 * @example
 * const data = stringifyJsonbFields(personData, ['onHoldHistory', 'extensionHistory']);
 */
export function stringifyJsonbFields<T extends Record<string, any>>(
  data: T,
  jsonbFields: string[]
): T {
  const stringified: any = { ...data };

  for (const field of jsonbFields) {
    if (stringified[field] && typeof stringified[field] === 'object') {
      stringified[field] = JSON.stringify(stringified[field]);
    }
  }

  return stringified as T;
}

/**
 * Ejecuta `fn` dentro de una transacción SQL (BEGIN/COMMIT/ROLLBACK).
 * Garantía: o se aplican TODAS las queries o NINGUNA. Si `fn` lanza, se
 * hace ROLLBACK automático y el error se re-lanza.
 *
 * Úsalo cuando 2+ operaciones SQL deben ser atómicas (ej: INSERT en log
 * + UPDATE/DELETE en tabla principal). El cliente PoolClient está reservado
 * para esta operación y se libera siempre, incluso si hay error.
 *
 * @example
 *   await withTransaction(async (client) => {
 *     await client.query('INSERT INTO "LOG" (...) VALUES (...)', [...]);
 *     await client.query('UPDATE "T" SET ... WHERE ...', [...]);
 *   });
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    client.release();
  }
}

// Export pool for direct access if needed
export default pool;
