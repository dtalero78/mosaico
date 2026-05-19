/**
 * API: /api/postgres/pagos-titulares/[id]/validar
 *
 * POST → marca validado=true, fechaValidacion=hoy, validadoPor=session.user.email
 * Idempotente: si ya está validado lanza error
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const POST = handlerWithAuth(async (_req, ctx, session) => {
  const validadoPor = (session.user as any)?.email || 'unknown';
  const pago = await pagosTitularesService.validar(ctx.params.id, validadoPor);
  return successResponse({ pago });
});
