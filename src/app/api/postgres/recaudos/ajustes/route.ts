/**
 * GET /api/postgres/recaudos/ajustes?tipo=INSCRIPCION|PAGO|FACTURA&q=
 *     → registros VALIDADOS ajustables (máx. 100)
 * GET ?historial=1&tipo=  → últimos ajustes hechos (PAGOS_AJUSTES)
 *
 * Gateado por el permiso de la subpestaña (RECAUDOS.AJUSTES.*); SUPER_ADMIN/ADMIN
 * pasan. Respeta el alcance por plataforma de Recaudos.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission, requireAnyPermission } from '@/lib/api-permissions';
import { ValidationError } from '@/lib/errors';
import { pagosAjustesService, TIPOS_AJUSTE, type TipoAjuste } from '@/services/pagos-ajustes.service';
import { permisoAjuste, PERMISOS_AJUSTE, sessionInfo } from './permisos';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const tipoRaw = (searchParams.get('tipo') || '').toUpperCase();
  const tipo = TIPOS_AJUSTE.includes(tipoRaw as TipoAjuste) ? (tipoRaw as TipoAjuste) : null;

  if (searchParams.get('historial') === '1') {
    if (tipo) await requirePermission(session, permisoAjuste(tipo));
    else await requireAnyPermission(session, PERMISOS_AJUSTE);
    const ajustes = await pagosAjustesService.historial(sessionInfo(session), tipo);
    return successResponse({ ajustes });
  }

  if (!tipo) throw new ValidationError('tipo debe ser INSCRIPCION, PAGO o FACTURA');
  await requirePermission(session, permisoAjuste(tipo));
  const pagos = await pagosAjustesService.buscar(sessionInfo(session), tipo, searchParams.get('q'));
  return successResponse({ pagos });
});
