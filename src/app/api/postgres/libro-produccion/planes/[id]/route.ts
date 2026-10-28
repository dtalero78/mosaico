import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { guardarTipoPlan } from '@/services/libro-produccion.service';

/**
 * PATCH /api/postgres/libro-produccion/planes/[id]  Body: mismos campos que el POST.
 * Edita o desactiva (activo:false) un tipo de plan. No se borra: puede estar en contratos.
 * Gate: APROBACION.LIBRO_PRODUCCION.PLANES.
 */
export const PATCH = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_PLANES);
  const body = await req.json().catch(() => ({}));
  await guardarTipoPlan(body, (session?.user as any)?.email || 'desconocido', ctx.params.id);
  return successResponse({ id: ctx.params.id });
});
