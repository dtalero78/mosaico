/**
 * PATCH /api/postgres/admin-events/[id]/registrar
 *
 * El advisor (o coord/admin) "marca tarjeta" del evento administrativo dentro
 * de su ventana +40/+120. Body: { timeout: 'HH:MM', notas? }. Permiso:
 * ADMIN_EVENTS.REGISTRAR (el rol ADVISOR lo tiene por default; coord/admin
 * bypassean ventana en el service).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError, UnauthorizedError } from '@/lib/errors';
import { registrarAdminEvent } from '@/services/admin-events.service';

export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.ADMIN_EVENTS_REGISTRAR);

  const email = (session?.user as any)?.email;
  const role  = (session?.user as any)?.role;
  if (!email || !role) throw new UnauthorizedError('Sesión incompleta');

  const body = await request.json();
  const timeout = String(body?.timeout || '').trim();
  const notas   = body?.notas ? String(body.notas).trim() : null;
  if (!timeout) throw new ValidationError('timeout requerido (HH:MM)');

  const updated = await registrarAdminEvent({
    id: params.id, sessionEmail: email, sessionRole: role, timeout, notas,
  });
  return successResponse({ event: updated });
});
