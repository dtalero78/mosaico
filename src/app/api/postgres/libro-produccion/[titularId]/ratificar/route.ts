import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { ratificarContrato } from '@/services/libro-depuracion.service';

/**
 * POST — ratifica como firmado un contrato sin firma con el correo del "Sí, acepto".
 * Body: { documento: { url, nombre, tipo }, confirmarOtros }. Queda firmado (tipo CORREO) y LISTO.
 */
export const POST = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_RATIFICAR);
  const b = await req.json().catch(() => ({}));
  const r = await ratificarContrato(session, ctx.params.titularId, {
    documento: b?.documento, confirmarOtros: b?.confirmarOtros === true,
  }, {
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 45),
    userAgent: req.headers.get('user-agent') || '',
  });
  return successResponse({ resultado: r });
});
