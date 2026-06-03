/**
 * PATCH  /api/postgres/admin-events/[id]   → editar (admin) — solo si NO registrado
 * DELETE /api/postgres/admin-events/[id]   → eliminar 1 fila
 *
 * Gateado por ADMIN_EVENTS.GESTIONAR.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { NotFoundError } from '@/lib/errors';
import { updateAdminEvent, deleteAdminEvent } from '@/services/admin-events.service';

export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);
  const body = await request.json();
  const updated = await updateAdminEvent(params.id, {
    tipo:        body?.tipo,
    titulo:      body?.titulo !== undefined ? (body.titulo ? String(body.titulo).trim() : null) : undefined,
    descripcion: body?.descripcion !== undefined ? (body.descripcion ? String(body.descripcion).trim() : null) : undefined,
    fechaInicio: body?.fechaInicio,
    horas:       body?.horas !== undefined ? Number(body.horas) : undefined,
  });
  return successResponse({ event: updated });
});

export const DELETE = handlerWithAuth(async (_request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);
  const n = await deleteAdminEvent(params.id);
  if (n === 0) throw new NotFoundError('Admin Event', params.id);
  return successResponse({ deleted: n });
});
