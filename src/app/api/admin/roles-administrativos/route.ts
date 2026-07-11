import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { queryMany } from '@/lib/postgres';

// Roles que NO son "administrativos" (tienen su propia opción en el hub).
export const ROLES_EXCLUIDOS = ['ESTUDIANTE', 'GUIA', 'COMERCIAL', 'COMERCIAL_JEFE'];

/**
 * GET /api/admin/roles-administrativos
 * Roles activos de ROL_PERMISOS para el alta de staff, excluyendo Estudiante,
 * Guía y Comercial (que tienen su propio flujo). Gateado por CREAR_ROL.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CREAR_ROL);
  const rows = await queryMany<{ rol: string; descripcion: string | null }>(
    `SELECT "rol", "descripcion" FROM "ROL_PERMISOS"
     WHERE "activo" = true AND "rol" <> ALL($1)
     ORDER BY "rol" ASC`,
    [ROLES_EXCLUIDOS]
  );
  return successResponse({ roles: rows });
});
