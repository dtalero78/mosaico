import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { editarUsuario, eliminarUsuario } from '@/services/usuarios-roles-admin.service';

/**
 * PATCH  /api/admin/users/[id]   { nombre?, apellido?, email?, celular?, plataforma?, activo? }
 * DELETE /api/admin/users/[id]   { motivo }
 *
 * Editar y Eliminar de Gestión de Usuarios. Cada acción con su permiso; las
 * guardas (no tocar ADMIN/SUPER_ADMIN, no eliminarse a sí mismo) están en el
 * servicio.
 */
export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, MantenimientoPermission.USUARIO_EDITAR);
  const body = await request.json().catch(() => ({}));
  const r = await editarUsuario(params.id, {
    nombre: body?.nombre, apellido: body?.apellido, email: body?.email,
    celular: body?.celular, plataforma: body?.plataforma,
    activo: typeof body?.activo === 'boolean' ? body.activo : undefined,
  });
  return successResponse({ ...r, message: 'Cuenta actualizada.' });
});

export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, MantenimientoPermission.USUARIO_ELIMINAR);
  const body = await request.json().catch(() => ({}));
  const u = (session?.user as any) || {};
  const r = await eliminarUsuario(params.id, body?.motivo, {
    email: String(u.email || ''), nombre: u.name || null, id: String(u.id || ''),
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '',
    userAgent: request.headers.get('user-agent') || '',
  });
  return successResponse({ ...r, message: 'Cuenta eliminada.' });
});
