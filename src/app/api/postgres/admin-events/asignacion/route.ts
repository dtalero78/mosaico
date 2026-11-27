/**
 * Asignación Horas Administrativas.
 *
 * GET    ?startDate&endDate&advisorId → asignaciones (tipo ASIGNACION)
 * POST   {advisorIds, fechaInicio, horas, motivo, tz} → crea (nacen registradas)
 * DELETE ?groupId=…  o  ?id=… → borra una asignación (todo el grupo o una fila)
 *
 * Gateado por ACADEMICO.HORAS_ADMIN.ASIGNAR.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, NotFoundError } from '@/lib/errors';
import {
  listAdminEvents, asignarHorasAdministrativas, deleteAdminEvent, deleteAdminEventGroup,
} from '@/services/admin-events.service';
import { AdminEventsRepository } from '@/repositories/admin-events.repository';
import { ADMIN_EVENT_TIPO_ASIGNACION } from '@/lib/admin-event-window';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.HORAS_ADMIN_ASIGNAR);
  const { searchParams } = new URL(request.url);
  const items = await listAdminEvents({
    startDate: searchParams.get('startDate'),
    endDate:   searchParams.get('endDate'),
    advisorId: searchParams.get('advisorId'),
    tipo: ADMIN_EVENT_TIPO_ASIGNACION,
  });
  return successResponse({ items, total: items.length });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.HORAS_ADMIN_ASIGNAR);
  const body = await request.json();
  const result = await asignarHorasAdministrativas({
    advisorIds: Array.isArray(body?.advisorIds) ? body.advisorIds.map(String) : [],
    fechaInicio: String(body?.fechaInicio || '').trim(),
    horas: Number(body?.horas),
    motivo: String(body?.motivo || ''),
    createdBy: (session?.user as any)?.email ?? null,
    tz: body?.tz ? String(body.tz) : null,
  });
  return successResponse({
    ...result,
    message: `Horas asignadas a ${result.count} guía(s)`,
  });
});

export const DELETE = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.HORAS_ADMIN_ASIGNAR);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');
  if (!id && !groupId) throw new ValidationError('id o groupId requerido');

  // Sólo se borran asignaciones: este permiso no alcanza a los eventos administrativos.
  if (id) {
    const ev = await AdminEventsRepository.findById(id);
    if (!ev || ev.tipo !== ADMIN_EVENT_TIPO_ASIGNACION) throw new NotFoundError('Asignación', id);
    const deleted = await deleteAdminEvent(id);
    return successResponse({ deleted });
  }
  const rows = await AdminEventsRepository.findByGroupId(groupId!);
  if (rows.length === 0 || rows.some(r => r.tipo !== ADMIN_EVENT_TIPO_ASIGNACION)) {
    throw new NotFoundError('Asignación', groupId!);
  }
  const deleted = await deleteAdminEventGroup(groupId!);
  return successResponse({ deleted });
});
