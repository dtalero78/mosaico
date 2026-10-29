import { NextRequest } from 'next/server';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { depurarContrato } from '@/services/libro-depuracion.service';

/**
 * POST — BORRA el contrato y todos sus registros. Body: { motivo, confirmoDescarga, confirmarOtros }.
 * Irreversible desde la interfaz; el snapshot completo queda en PURGE_LOG (tipo DEPURACION_LIBRO).
 */
export const POST = handlerWithAuth(async (req: NextRequest, ctx, session) => {
  await requirePermission(session, AprobacionPermission.LIBRO_PRODUCCION_DEPURAR);
  const b = await req.json().catch(() => ({}));
  const u: any = session?.user || {};
  const r = await depurarContrato(ctx.params.titularId, {
    motivo: b?.motivo, confirmoDescarga: b?.confirmoDescarga === true, confirmarOtros: b?.confirmarOtros === true,
  }, {
    actorEmail: u.email || 'desconocido', actorNombre: u.name || null,
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 45),
    userAgent: req.headers.get('user-agent') || '',
  });
  return successResponse({ resultado: r });
});
