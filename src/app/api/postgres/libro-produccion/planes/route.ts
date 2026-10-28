import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requireAnyPermission, requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { listarPlanes, guardarTipoPlan } from '@/services/libro-produccion.service';

/**
 * GET  /api/postgres/libro-produccion/planes?pais=   → catálogo de planes y tipos (VER o PLANES)
 * POST /api/postgres/libro-produccion/planes          Body: { pais, cuotas, nombre, inscripcion?, valorCuota?, total?, descripcion?, activo? }
 *      Crea un tipo de plan (PLANES).
 */
export const GET = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requireAnyPermission(session, [AprobacionPermission.LIBRO_PRODUCCION_VER, AprobacionPermission.LIBRO_PRODUCCION_PLANES]);
  const pais = new URL(req.url).searchParams.get('pais');
  return successResponse({ planes: await listarPlanes(pais) });
});

export const POST = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_PLANES);
  const body = await req.json().catch(() => ({}));
  const id = await guardarTipoPlan(body, (session?.user as any)?.email || 'desconocido');
  return successResponse({ id });
});
