/**
 * API: /api/postgres/pagos-titulares/penalidad/[id]/cancelar
 *
 * POST { motivo } → cancela la penalidad activa y devuelve el contrato a su plan inicial.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { penalidadService } from '@/services/penalidad.service';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL_CANCELAR_PENALIDAD);
  const b = await req.json().catch(() => ({}));
  const actor = (session.user as any)?.email || 'unknown';
  return successResponse(await penalidadService.cancelar(ctx.params.id, String(b?.motivo || ''), actor));
});
