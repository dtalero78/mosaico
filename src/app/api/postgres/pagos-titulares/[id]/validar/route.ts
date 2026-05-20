/**
 * API: /api/postgres/pagos-titulares/[id]/validar
 *
 * POST { numeroFactura } → marca validado=true, fechaValidacion=hoy,
 *                          validadoPor=session.user.email y guarda
 *                          el número de factura (requerido).
 *
 * Idempotente: si ya está validado lanza error.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_VALIDAR);

  const validadoPor = (session.user as any)?.email || 'unknown';
  const body = await req.json().catch(() => ({}));
  const numeroFactura = (body?.numeroFactura ?? '').toString();
  const pago = await pagosTitularesService.validar(ctx.params.id, validadoPor, numeroFactura);
  return successResponse({ pago });
});
