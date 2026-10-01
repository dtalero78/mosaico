import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { cambiarClave } from '@/services/usuarios-roles-admin.service';

/**
 * POST /api/admin/users/[id]/clave   { clave }
 *
 * Botón "Clave" de Gestión de Usuarios: le asigna una clave nueva a la cuenta.
 * No toca cuentas ADMIN/SUPER_ADMIN (guarda en el servicio).
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, MantenimientoPermission.USUARIO_CLAVE);
  const body = await request.json().catch(() => ({}));
  const r = await cambiarClave(params.id, body?.clave);
  return successResponse({ ...r, message: 'Clave actualizada.' });
});
