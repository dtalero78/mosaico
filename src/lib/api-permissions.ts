/**
 * Server-side permission verification helper for API routes.
 *
 * Usage:
 *   import { requirePermission } from '@/lib/api-permissions';
 *   await requirePermission(session, PersonPermission.PAGOS_VALIDAR);
 *
 * - SUPER_ADMIN and ADMIN bypass automatically (consistent with `PermissionGuard.isRole` en frontend).
 * - Lee permisos directo del repositorio (no via HTTP) y cachea por rol durante 5 min.
 * - Throws ForbiddenError si falta el permiso.
 */

import 'server-only';
import { Session } from 'next-auth';
import { ForbiddenError } from './errors';
import { Permission, Role } from '@/types/permissions';
import { RolPermisosRepository } from '@/repositories/roles.repository';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { perms: string[]; expires: number }>();

async function loadPermissions(role: string): Promise<string[]> {
  const cached = cache.get(role);
  if (cached && cached.expires > Date.now()) return cached.perms;

  const row = await RolPermisosRepository.findByRol(role);
  const perms = Array.isArray((row as any)?.permisos) ? (row as any).permisos as string[] : [];

  cache.set(role, { perms, expires: Date.now() + CACHE_TTL_MS });
  return perms;
}

export async function requirePermission(session: Session | null, permission: Permission): Promise<void> {
  const role = ((session?.user as any)?.role ?? '') as string;

  // SUPER_ADMIN / ADMIN bypass — coincide con PermissionGuard del frontend
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN || role === 'admin') return;

  const perms = await loadPermissions(role);
  if (!perms.includes(permission)) {
    throw new ForbiddenError(`Permiso requerido: ${permission}`);
  }
}

/**
 * Exige SUPER_ADMIN o ADMIN, sin pasar por un permiso del catálogo.
 *
 * Es para las operaciones que NO deben poder delegarse marcando una casilla en
 * `/admin/permissions`: crear roles, reescribir los permisos de un rol y cambiar
 * el rol de un usuario. Un permiso para eso sería la llave que abre todas las
 * demás — quien lo tuviera podría darse a sí mismo cualquier otro.
 */
export function requireAdmin(session: Session | null, accion = 'esta operación'): void {
  const role = ((session?.user as any)?.role ?? '') as string;
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN || role === 'admin') return;
  throw new ForbiddenError(`Solo SUPER_ADMIN puede ${accion}`);
}

/**
 * Igual que `requirePermission` pero basta con tener UNO de los permisos.
 * Para endpoints que sirven a más de una pantalla — p. ej. el reporte de
 * cuestionarios, que alimenta tanto Evaluaciones como Entrenamientos y a cuyos
 * roles se les puede dar sólo uno de los dos accesos.
 */
export async function requireAnyPermission(session: Session | null, permissions: Permission[]): Promise<void> {
  const role = ((session?.user as any)?.role ?? '') as string;
  if (role === Role.SUPER_ADMIN || role === Role.ADMIN || role === 'admin') return;

  const perms = await loadPermissions(role);
  if (!permissions.some(p => perms.includes(p))) {
    throw new ForbiddenError(`Permiso requerido: ${permissions.join(' o ')}`);
  }
}
