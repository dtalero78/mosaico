/**
 * PATCH /api/admin/libros-interactivos/feature-flag
 *
 * Body: { active: boolean }
 *
 * Activa/desactiva el feature flag global de "Material Interactivo v2".
 * Gateado por permiso ACADEMICO.MATERIAL.ACTUALIZAR.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';

export const PATCH = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const body = await req.json().catch(() => ({}));
  if (typeof body?.active !== 'boolean') {
    throw new ValidationError('Body debe incluir "active" boolean');
  }
  const actor = (session.user as any)?.email || 'admin';
  await LibrosInteractivosService.setFeatureActive(body.active, actor);
  return successResponse({ active: body.active });
});
