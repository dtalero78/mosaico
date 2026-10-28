import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { actualizarCasillas } from '@/services/libro-produccion.service';

/**
 * PATCH /api/postgres/libro-produccion/[titularId]/casillas   Body: { suscripcionPago?, prixus? }
 * Casillas manuales del titular. Las usan el libro y la ficha › Información general.
 * Gate: staff + APROBACION.LIBRO_PRODUCCION.CASILLAS.
 */
export const PATCH = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_CASILLAS);
  const body = await req.json().catch(() => ({}));
  const actor = (session?.user as any)?.email || 'desconocido';
  const casillas = await actualizarCasillas(ctx.params.titularId, {
    suscripcionPago: typeof body?.suscripcionPago === 'boolean' ? body.suscripcionPago : undefined,
    prixus: typeof body?.prixus === 'boolean' ? body.prixus : undefined,
  }, actor);
  return successResponse({ casillas });
});
