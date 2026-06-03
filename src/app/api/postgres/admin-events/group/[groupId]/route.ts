/**
 * DELETE /api/postgres/admin-events/group/[groupId]
 *
 * Elimina TODO el grupo (todas las filas con el mismo eventGroupId).
 * Útil cuando se creó un Meeting para 5 advisors y se quiere cancelar para
 * todos en bloque.
 *
 * Gateado por ADMIN_EVENTS.GESTIONAR.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { NotFoundError } from '@/lib/errors';
import { deleteAdminEventGroup } from '@/services/admin-events.service';

export const DELETE = handlerWithAuth(async (_request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);
  const n = await deleteAdminEventGroup(params.groupId);
  if (n === 0) throw new NotFoundError('Admin Event Group', params.groupId);
  return successResponse({ deleted: n });
});
