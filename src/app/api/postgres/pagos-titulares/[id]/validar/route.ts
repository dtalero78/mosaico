/**
 * API: /api/postgres/pagos-titulares/[id]/validar
 *
 * POST { numeroFactura, fechaValidacion? } → marca validado=true,
 *      fechaValidacion = la del cliente (YYYY-MM-DD en su TZ local) o
 *                        CURRENT_DATE si no se envía,
 *      validadoPor    = session.user.email,
 *      numeroFactura  (requerido).
 *
 * El cliente envía su `fechaValidacion` para evitar corrimiento de día
 * por diferencias TZ entre el navegador del usuario y el server.
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
  const fechaValidacion = (body?.fechaValidacion ?? '').toString() || null;
  const pago = await pagosTitularesService.validar(ctx.params.id, validadoPor, numeroFactura, fechaValidacion);
  return successResponse({ pago });
});
