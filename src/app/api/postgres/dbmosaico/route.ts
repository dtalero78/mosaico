/**
 * GET /api/postgres/dbmosaico
 *
 * Database viewer metadata endpoints:
 *   ?action=list-tables  → list all tables
 *   ?action=schema&table=X → get column metadata for a table
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

export const GET = handlerWithAuth(async (request, _context, session) => {
  assertAdmin(session);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list-tables';

  if (action === 'list-tables') {
    const tables = await DbmosaicoService.listTables();
    return successResponse({ tables });
  }

  if (action === 'schema') {
    const table = searchParams.get('table');
    if (!table) throw new ValidationError('Parámetro "table" es requerido');
    const schema = await DbmosaicoService.getTableSchema(table);
    return successResponse(schema);
  }

  throw new ValidationError(`Acción desconocida: ${action}`);
});
