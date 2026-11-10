import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { leerEscaleraCorreo } from '@/services/libro-produccion.service';

/**
 * POST /api/postgres/libro-produccion/[titularId]/escalera/leer-correo  Body: { texto? , imagen? (data URL) }
 * Lee con IA la "Escala de matrícula" del correo de la matrícula y la PROPONE (no guarda nada).
  * Gate: APROBACION.LIBRO_PRODUCCION.ESCALERA.
 */
export const POST = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_ESCALERA);
  const body = await req.json().catch(() => ({}));
  return successResponse(await leerEscaleraCorreo(ctx.params.titularId, { texto: body?.texto, imagen: body?.imagen }));
});
