import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { registroLibro } from '@/services/libro-produccion.service';

/**
 * GET /api/postgres/libro-produccion/[titularId]
 * Vista detallada de un contrato del Libro de Producción (con su vigencia y semana).
 * Gate: staff + APROBACION.LIBRO_PRODUCCION.VER.
 */
export const GET = handlerWithAuth(async (_req, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_VER);
  return successResponse(await registroLibro(ctx.params.titularId));
});
