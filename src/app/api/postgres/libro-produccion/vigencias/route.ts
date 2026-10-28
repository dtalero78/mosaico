import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { listarVigencias, generarVigenciasAnio } from '@/services/libro-produccion.service';

/**
 * GET  /api/postgres/libro-produccion/vigencias  → todas las vigencias (VER)
 * POST /api/postgres/libro-produccion/vigencias  Body: { anio, inicioEnero, fines: [12 × 'YYYY-MM-DD'], hora? }
 *      Genera o reemplaza las 12 vigencias del año (VIGENCIAS). Corte por defecto 09:00.
 */
export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_VER);
  return successResponse({ vigencias: await listarVigencias() });
});

export const POST = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_VIGENCIAS);
  const body = await req.json().catch(() => ({}));
  const actor = (session?.user as any)?.email || 'desconocido';
  const vigencias = await generarVigenciasAnio(
    Number(body?.anio), String(body?.inicioEnero || ''),
    Array.isArray(body?.fines) ? body.fines.map((x: any) => String(x || '')) : [],
    String(body?.hora || '09:00'), actor);
  return successResponse({ vigencias });
});
