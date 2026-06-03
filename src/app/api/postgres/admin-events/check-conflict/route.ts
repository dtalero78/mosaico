/**
 * POST /api/postgres/admin-events/check-conflict
 *
 * Verifica si una propuesta de admin event tiene conflictos con:
 *   - CALENDARIO académico del/los advisor(s)
 *   - Otros admin events del mismo advisor en el mismo rango
 *
 * Body: { advisorIds: string[], fechaInicio: ISO, horas: number, excludeGroupId? }
 * Response: { hasConflicts: boolean, conflicts: ConflictDetail[] }
 *
 * Gateado por ADMIN_EVENTS.GESTIONAR.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { checkConflicts } from '@/services/admin-events.service';

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_GESTIONAR);

  const body = await request.json();
  const advisorIds: string[] = Array.isArray(body?.advisorIds) ? body.advisorIds : [];
  const fechaInicio = String(body?.fechaInicio || '').trim();
  const horas = Number(body?.horas);
  const excludeGroupId = body?.excludeGroupId ? String(body.excludeGroupId) : null;

  if (!fechaInicio) throw new ValidationError('fechaInicio requerido');
  if (!Number.isInteger(horas)) throw new ValidationError('horas debe ser entero');

  const conflicts = await checkConflicts({ advisorIds, fechaInicio, horas, excludeGroupId });
  return successResponse({ hasConflicts: conflicts.length > 0, conflicts });
});
