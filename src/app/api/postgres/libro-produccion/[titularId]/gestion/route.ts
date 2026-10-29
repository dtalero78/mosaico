import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { analizarContrato } from '@/services/libro-depuracion.service';

/** GET — análisis del contrato para el modal de depurar / ratificar. */
export const GET = handlerWithAuth(async (_req, ctx, session) => {
  await requireAnyPermission(session, [AprobacionPermission.LIBRO_PRODUCCION_DEPURAR, AprobacionPermission.LIBRO_PRODUCCION_RATIFICAR]);
  return successResponse({ analisis: await analizarContrato(ctx.params.titularId) });
});
