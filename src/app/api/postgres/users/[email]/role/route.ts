import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { RolPermisosRepository, UsuariosRolesRepository } from '@/repositories/roles.repository';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { requireAdmin } from '@/lib/api-permissions';

/**
 * GET /api/postgres/users/[email]/role
 */
export const GET = handlerWithAuth(async (request, { params }) => {
  const email = decodeURIComponent(params.email);
  const user = await UsuariosRolesRepository.findByEmail(email);

  if (!user) throw new NotFoundError('User', email);

  const roleData = await RolPermisosRepository.findByRol(user.rol);

  return successResponse({
    user: { email: user.email, rol: user.rol, activo: user.activo },
    permissions: roleData?.permisos || [],
    roleDescription: roleData?.descripcion || '',
  });
});

/**
 * PUT /api/postgres/users/[email]/role
 */
export const PUT = handlerWithAuth(async (request, { params }, session) => {
  // Cambiar el rol de un usuario es la operación con la que alguien podría
  // darse SUPER_ADMIN a sí mismo: no se delega por permiso.
  requireAdmin(session, 'cambiar el rol de un usuario');

  const body = await request.json();
  const { rol } = body;
  const email = decodeURIComponent(params.email);

  if (!rol) throw new ValidationError('rol is required');

  const user = await UsuariosRolesRepository.findByEmail(email);
  if (!user) throw new NotFoundError('User', email);

  const roleExists = await RolPermisosRepository.findByRol(rol);
  if (!roleExists) throw new NotFoundError('Role', rol);

  const updated = await UsuariosRolesRepository.updateRol(email, rol);

  return successResponse({ message: `Role updated to ${rol} for user ${email}`, user: updated });
});
