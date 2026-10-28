import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { libroDeVigencia } from '@/services/libro-produccion.service';

/**
 * GET /api/postgres/libro-produccion?vigenciaId=
 * Libro de Producción de una vigencia comercial (sin vigenciaId = la actual).
 * Devuelve las vigencias disponibles, la elegida y un registro por contrato con sus
 * beneficiarios. Gate: staff + APROBACION.LIBRO_PRODUCCION.VER.
 */
export const GET = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_VER);
  const vigenciaId = new URL(req.url).searchParams.get('vigenciaId');
  return successResponse(await libroDeVigencia(vigenciaId));
});
