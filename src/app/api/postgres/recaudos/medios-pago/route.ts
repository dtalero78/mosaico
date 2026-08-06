/**
 * API: /api/postgres/recaudos/medios-pago
 *
 * GET → lista de medios de pago distintos (para el dropdown del panel Bancos).
 * Gateado por RECAUDOS.GESTION.VER (mismo permiso del Centro de Validación).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.GESTION_VER);
  const medios = await pagosTitularesService.listMediosPago();
  return successResponse({ medios });
});
