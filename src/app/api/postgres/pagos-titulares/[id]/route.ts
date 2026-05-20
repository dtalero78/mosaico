/**
 * API: /api/postgres/pagos-titulares/[id]
 *
 * GET    → un pago
 * PATCH  → actualiza campos (recomputa saldo)
 * DELETE → borra pago (bloqueado si validado=true)
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_VER);
  const pago = await pagosTitularesService.getById(ctx.params.id);
  return successResponse({ pago });
});

export const PATCH = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  const body = await req.json();
  const pago = await pagosTitularesService.update(ctx.params.id, body);
  return successResponse({ pago });
});

export const DELETE = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_ELIMINAR);
  const userRole = ((session.user as any)?.role ?? '') as string;
  await pagosTitularesService.remove(ctx.params.id, userRole);
  return successResponse({ deleted: true });
});
