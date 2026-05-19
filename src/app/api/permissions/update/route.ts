/**
 * API Route: /api/permissions/update
 * POST - Actualiza los permisos de un rol específico en PostgreSQL ROL_PERMISOS
 * Solo disponible para SUPER_ADMIN
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ForbiddenError, ValidationError, NotFoundError } from '@/lib/errors';
import { Role, PersonPermission, StudentPermission, AcademicoPermission, InformesPermission, ServicioPermission, ComercialPermission, AprobacionPermission, MantenimientoPermission, RecaudosPermission } from '@/types/permissions';
import { invalidatePermissionsCache } from '@/config/roles';
import { RolPermisosRepository } from '@/repositories/roles.repository';

const VALID_PERMISSIONS = new Set<string>([
  ...Object.values(PersonPermission),
  ...Object.values(StudentPermission),
  ...Object.values(AcademicoPermission),
  ...Object.values(InformesPermission),
  ...Object.values(ServicioPermission),
  ...Object.values(ComercialPermission),
  ...Object.values(AprobacionPermission),
  ...Object.values(MantenimientoPermission),
  ...Object.values(RecaudosPermission),
]);

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  const userRole = (session.user as any).role as Role;

  if (userRole !== Role.SUPER_ADMIN && userRole !== Role.ADMIN) {
    throw new ForbiddenError('Solo SUPER_ADMIN puede modificar permisos');
  }

  const body = await req.json();
  const { role, permissions } = body;

  if (!role || !permissions) {
    throw new ValidationError('Faltan parámetros: role y permissions son requeridos');
  }

  if (!Array.isArray(permissions)) {
    throw new ValidationError('permissions debe ser un array');
  }

  const invalidPerms = permissions.filter((p: any) => !p || p === 'undefined' || p === undefined || typeof p !== 'string');
  if (invalidPerms.length > 0) {
    throw new ValidationError(`Algunos permisos son inválidos: ${invalidPerms.length} de ${permissions.length} total`);
  }

  const unknownPerms = permissions.filter((p: string) => !VALID_PERMISSIONS.has(p));
  if (unknownPerms.length > 0) {
    throw new ValidationError(`Permisos no reconocidos: ${unknownPerms.join(', ')}`);
  }

  const existing = await RolPermisosRepository.findByRol(role);
  if (!existing) throw new NotFoundError('Role', role);

  console.log(`🔄 Actualizando permisos de ${role} (${permissions.length} permisos)`);

  await RolPermisosRepository.updatePermisos(role, permissions);

  invalidatePermissionsCache(role as Role);
  console.log(`✅ Permisos de ${role} actualizados. Cache invalidado.`);

  return successResponse({
    message: `Permisos de ${role} actualizados exitosamente`,
    role,
    permissions,
    count: permissions.length,
    cacheInvalidated: true,
  });
});
