/**
 * /api/postgres/dbmosaico/[table]
 *
 * CRUD endpoints for any table:
 *   GET    → Read rows with pagination, sorting, filtering, search
 *   POST   → Insert a new row
 *   PATCH  → Update a single cell
 *   DELETE → Delete selected rows
 *
 * Restricted to SUPER_ADMIN/ADMIN roles.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { DbmosaicoService } from '@/services/dbmosaico.service';
import { ForbiddenError, ValidationError } from '@/lib/errors';
import { Role } from '@/types/permissions';

function assertAdmin(session: any): void {
  const userRole = (session.user as any)?.role;
  const allowed = [Role.SUPER_ADMIN, Role.ADMIN, 'admin'];
  if (!allowed.includes(userRole)) {
    throw new ForbiddenError('Solo SUPER_ADMIN/ADMIN pueden acceder al visor de base de datos');
  }
}

/**
 * GET /api/postgres/dbmosaico/[table]?page=1&pageSize=50&sortBy=&sortDir=asc&search=&filters={}
 */
export const GET = handlerWithAuth(async (request, { params }, session) => {
  assertAdmin(session);

  const table = params.table;
  if (!table) throw new ValidationError('Tabla es requerida');

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
  const sortBy = searchParams.get('sortBy') || undefined;
  const sortDir = (searchParams.get('sortDir') || 'asc') as 'asc' | 'desc';
  const search = searchParams.get('search') || undefined;
  const filtersRaw = searchParams.get('filters');
  const filters = filtersRaw ? JSON.parse(filtersRaw) : undefined;
  const isExport = searchParams.get('export') === 'true';

  const result = await DbmosaicoService.readRows(table, {
    page, pageSize, sortBy, sortDir, search, filters, export: isExport,
  });

  return successResponse(result);
});

/**
 * POST /api/postgres/dbmosaico/[table]
 * Body: { row: { col1: val1, col2: val2, ... } }
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  assertAdmin(session);

  const table = params.table;
  if (!table) throw new ValidationError('Tabla es requerida');

  const body = await request.json();
  if (!body.row || typeof body.row !== 'object') {
    throw new ValidationError('Se requiere un objeto "row"');
  }

  const inserted = await DbmosaicoService.insertRow(table, body.row);
  return successResponse({ row: inserted }, 201);
});

/**
 * PATCH /api/postgres/dbmosaico/[table]
 * Body: { rowId: string, column: string, value: any }
 */
export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  assertAdmin(session);

  const table = params.table;
  if (!table) throw new ValidationError('Tabla es requerida');

  const { rowId, column, value } = await request.json();
  if (!rowId) throw new ValidationError('"rowId" es requerido');
  if (!column) throw new ValidationError('"column" es requerido');

  const updated = await DbmosaicoService.updateCell(table, rowId, column, value);
  return successResponse({ row: updated });
});

/**
 * DELETE /api/postgres/dbmosaico/[table]
 * Body: { ids: string[] }
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  assertAdmin(session);

  const table = params.table;
  if (!table) throw new ValidationError('Tabla es requerida');

  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('Se requiere un array "ids" con al menos un elemento');
  }

  const deletedCount = await DbmosaicoService.deleteRows(table, ids);
  return successResponse({ deletedCount });
});
