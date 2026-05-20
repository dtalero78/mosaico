/**
 * API: /api/postgres/pagos-titulares/[id]/recibo
 *
 * POST → genera el PDF del recibo del pago (sólo si validado=true) y
 *        devuelve `{ pdfUrl, numeroRecibo }`.
 *
 * Numeración consecutiva global LGS-#### asignada en el primer POST y
 * conservada en posteriores llamados (idempotente).
 *
 * Gateado por PERSON.FINANCIERA.PAGOS_RECIBO.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const POST = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_RECIBO);
  const result = await pagosTitularesService.generarRecibo(ctx.params.id);
  return successResponse(result);
});
