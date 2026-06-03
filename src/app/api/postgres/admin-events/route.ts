/**
 * GET  /api/postgres/admin-events  → lista admin con filtros (gateado por
 *                                     ADMIN_EVENTS.VER_TODOS o GESTIONAR)
 * POST /api/postgres/admin-events  → crear lote (gateado por GESTIONAR)
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { listAdminEvents, createAdminEvents } from '@/services/admin-events.service';
import type { AdminEventTipo } from '@/lib/admin-event-window';
import { ADMIN_EVENT_TIPOS } from '@/lib/admin-event-window';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  // VER_TODOS permite listar; si no lo tiene pero sí GESTIONAR, también puede.
  // Probamos con VER_TODOS primero; si falla, GESTIONAR.
  try {
    await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_VER_TODOS);
  } catch {
    await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);
  }

  const { searchParams } = new URL(request.url);
  const tipoRaw = searchParams.get('tipo');
  const tipo: AdminEventTipo | null = tipoRaw && ADMIN_EVENT_TIPOS.includes(tipoRaw as AdminEventTipo)
    ? (tipoRaw as AdminEventTipo) : null;
  const regRaw = searchParams.get('registrado');
  const registrado: boolean | null = regRaw === 'true' ? true : regRaw === 'false' ? false : null;

  const items = await listAdminEvents({
    startDate: searchParams.get('startDate'),
    endDate:   searchParams.get('endDate'),
    advisorId: searchParams.get('advisorId'),
    tipo,
    registrado,
  });
  return successResponse({ items, total: items.length });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);

  const body = await request.json();
  const advisorIds: string[] = Array.isArray(body?.advisorIds) ? body.advisorIds : [];
  const tipo = String(body?.tipo || '').toUpperCase() as AdminEventTipo;
  const titulo = body?.titulo ? String(body.titulo).trim() : null;
  const descripcion = body?.descripcion ? String(body.descripcion).trim() : null;
  const fechaInicio = String(body?.fechaInicio || '').trim();
  const horas = Number(body?.horas);

  if (!fechaInicio) throw new ValidationError('fechaInicio requerido (ISO timestamp)');
  if (!Number.isInteger(horas)) throw new ValidationError('horas debe ser entero');

  const createdBy = (session?.user as any)?.email ?? null;

  const result = await createAdminEvents({
    advisorIds, tipo, titulo, descripcion, fechaInicio, horas, createdBy,
  });
  return successResponse(result);
});
