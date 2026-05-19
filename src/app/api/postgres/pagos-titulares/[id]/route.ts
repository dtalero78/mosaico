/**
 * API: /api/postgres/pagos-titulares/[id]
 *
 * GET    → un pago
 * PATCH  → actualiza campos (recomputa saldo)
 * DELETE → borra pago (bloqueado si validado=true)
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (_req, ctx) => {
  const pago = await pagosTitularesService.getById(ctx.params.id);
  return successResponse({ pago });
});

export const PATCH = handlerWithAuth(async (req, ctx) => {
  const body = await req.json();
  const pago = await pagosTitularesService.update(ctx.params.id, body);
  return successResponse({ pago });
});

export const DELETE = handlerWithAuth(async (_req, ctx) => {
  await pagosTitularesService.remove(ctx.params.id);
  return successResponse({ deleted: true });
});
