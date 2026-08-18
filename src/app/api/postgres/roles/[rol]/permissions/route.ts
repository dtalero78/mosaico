import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { RolPermisosRepository } from '@/repositories/roles.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { requireAdmin } from '@/lib/api-permissions';

/**
 * GET /api/postgres/roles/[rol]/permissions
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const rol = decodeURIComponent(params.rol);
  const roleData = await RolPermisosRepository.findByRol(rol);

  if (!roleData) throw new NotFoundError('Role', rol);

  return successResponse({
    rol: roleData.rol, permisos: roleData.permisos || [],
    descripcion: roleData.descripcion, activo: roleData.activo,
  });
});

/**
 * PUT /api/postgres/roles/[rol]/permissions
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  // Reescribir los permisos de un rol equivale a repartir accesos: no se delega.
  requireAdmin(session, 'modificar los permisos de un rol');

  const body = await request.json();
  const { permisos, descripcion } = body;
  const rol = decodeURIComponent(params.rol);

  if (!permisos || !Array.isArray(permisos)) throw new ValidationError('permisos array is required');

  const existing = await RolPermisosRepository.findByRol(rol);
  if (!existing) throw new NotFoundError('Role', rol);

  const role = await RolPermisosRepository.updatePermisos(rol, permisos, descripcion);

  return successResponse({ message: `Permissions updated for role ${rol}`, role, permissionsCount: permisos.length });
});
