/**
 * API: /api/postgres/recaudos/asignaciones
 *
 * GET ?search=&estadoCartera=&gestorRecaudo=&fechaInicio=&fechaFin=&page=&pageSize=
 *   → lista paginada de titulares asignados a gestores de recaudo
 *     ("Usuarios Asignados"). Filtrada server-side según rol del usuario:
 *
 *     - SUPER_ADMIN / ADMIN  → todos
 *     - RECAUDOS_JEFE        → todos los titulares cuyo gestor sea
 *                              RECAUDOS_JEFE o RECAUDOS_ASESOR
 *     - RECAUDOS_ASESOR        → sólo sus propios titulares (ignora override)
 *     - resto                → 403
 *
 * Sólo retorna titulares con `gestorRecaudo IS NOT NULL`.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.ASIGNACION_VER);

  const { searchParams } = new URL(req.url);
  const estadoParam = searchParams.get('estadoCartera');
  const estadoCartera =
    estadoParam === 'normal' ? 'normal' as const :
    estadoParam === 'prejuridico' ? 'prejuridico' as const :
    estadoParam === 'juridico' ? 'juridico' as const :
    estadoParam === 'castigada' ? 'castigada' as const :
    null;

  const data = await pagosTitularesService.listAsignaciones(
    {
      role: ((session.user as any)?.role ?? '').toString(),
      id: (session.user as any)?.id ?? null,
      email: session.user?.email ?? null,
    },
    {
      search:        searchParams.get('search')        || null,
      estadoCartera,
      gestorRecaudo: searchParams.get('gestorRecaudo') || null,
      fechaDesde:    searchParams.get('fechaInicio')   || null,
      fechaHasta:    searchParams.get('fechaFin')      || null,
      page:          parseInt(searchParams.get('page') || '1', 10) || 1,
      pageSize:      parseInt(searchParams.get('pageSize') || '50', 10) || 50,
    }
  );
  return successResponse(data);
});
