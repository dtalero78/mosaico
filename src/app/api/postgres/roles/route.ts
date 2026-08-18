import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { RolPermisosRepository } from '@/repositories/roles.repository';
import { ValidationError, ConflictError } from '@/lib/errors';
import { requireAdmin } from '@/lib/api-permissions';

/**
 * GET /api/postgres/roles
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const activo = searchParams.get('activo');

  const activeOnly = activo !== null ? activo === 'true' : undefined;
  const roles = await RolPermisosRepository.findAll(activeOnly);

  return successResponse({ roles, count: roles.length });
});

/**
 * POST /api/postgres/roles
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  // Crear un rol es crear un juego de permisos: no se delega.
  requireAdmin(session, 'crear roles');

  const body = await request.json();
  const { rol, permisos, descripcion, activo } = body;

  if (!rol || !permisos || !descripcion) throw new ValidationError('rol, permisos, and descripcion are required');
  if (!Array.isArray(permisos)) throw new ValidationError('permisos must be an array');

  const existing = await RolPermisosRepository.findByRol(rol);
  if (existing) throw new ConflictError(`Role ${rol} already exists`);

  const role = await RolPermisosRepository.create(rol, permisos, descripcion, activo !== undefined ? activo : true);

  return successResponse({ message: `Role ${rol} created successfully`, role, permissionsCount: permisos.length });
});
