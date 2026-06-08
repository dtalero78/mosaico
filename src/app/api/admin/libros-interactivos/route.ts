/**
 * GET /api/admin/libros-interactivos
 *
 * Devuelve el catálogo completo de libros con sus niveles vinculados,
 * y el estado del feature flag global. Solo SUPER_ADMIN/ADMIN
 * (gateado por permiso ACADEMICO.MATERIAL.ACTUALIZAR).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';

export const GET = handlerWithAuth(async (_req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const [libros, featureActive] = await Promise.all([
    LibrosInteractivosService.listAllForAdmin(),
    LibrosInteractivosService.isFeatureActive(),
  ]);
  return successResponse({ libros, featureActive });
});
