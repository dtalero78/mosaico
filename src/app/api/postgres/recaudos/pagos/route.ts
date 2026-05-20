/**
 * API: /api/postgres/recaudos/pagos
 *
 * GET ?estado=&fechaInicio=&fechaFin=&search=&page=&pageSize=
 *   → lista paginada de pagos del Centro de Validación de Pagos.
 *
 * Excluye cuota #0 (inscripción auto-validada al crear el contrato).
 *
 * Gateado por RECAUDOS.GESTION.VER (server-side defensa en profundidad,
 * además del PermissionGuard del frontend).
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.GESTION_VER);

  const { searchParams } = new URL(req.url);
  const estadoParam = searchParams.get('estado');
  const estado: 'validado' | 'pendiente' | undefined =
    estadoParam === 'validado' ? 'validado'
    : estadoParam === 'pendiente' ? 'pendiente'
    : undefined;

  const fechaInicio = searchParams.get('fechaInicio') || null;
  const fechaFin    = searchParams.get('fechaFin')    || null;
  const search      = searchParams.get('search')      || null;
  const page        = parseInt(searchParams.get('page') || '1', 10) || 1;
  const pageSize    = parseInt(searchParams.get('pageSize') || '50', 10) || 50;

  const data = await pagosTitularesService.listForGestion({
    estado,
    fechaDesde: fechaInicio,
    fechaHasta: fechaFin,
    search,
    page,
    pageSize,
  });

  return successResponse(data);
});
