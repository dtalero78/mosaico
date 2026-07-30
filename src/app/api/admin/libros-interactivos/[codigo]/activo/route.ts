/**
 * PATCH /api/admin/libros-interactivos/[codigo]/activo
 *
 * Body: { activo: boolean }
 *
 * Muestra/oculta el "Material Interactivo" de ese curso para los estudiantes.
 * Con activo=false el visor devuelve available:false y la tarjeta desaparece del
 * panel del alumno (útil para hacer adecuaciones sin borrar el libro).
 *
 * Gateado por permiso ACADEMICO.MATERIAL.ACTUALIZAR (SUPER_ADMIN/ADMIN bypass).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { LibrosInteractivosService } from '@/services/libros-interactivos.service';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';

export const PATCH = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const codigo = decodeURIComponent(ctx.params.codigo || '').toUpperCase().trim();
  if (!codigo) throw new ValidationError('codigo requerido');

  const body = await req.json().catch(() => ({}));
  const activo = !!body?.activo;

  await LibrosInteractivosService.setActivo(codigo, activo);
  return successResponse({ codigo, activo });
});
