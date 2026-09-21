import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import {
  previsualizarAjuste,
  aplicarCierre,
  aplicarAmpliacion,
  type AccionAjuste,
} from '@/services/ajuste-curso.service';

/**
 * POST /api/postgres/campaigns/[id]/ajuste
 * Body: { accion: 'cierre' | 'ampliacion', fecha: 'YYYY-MM-DD', motivo?: string, apply?: boolean }
 *
 *  - apply=false (o ausente): vista previa, no escribe nada.
 *  - apply=true: aplica. El motivo es obligatorio y el autor sale de la sesión.
 *
 * Cierre: `fecha` = última clase que se dicta. Ampliación: `fecha` = nuevo Final curso.
 */
export const POST = handlerWithAuth(async (request, ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_AJUSTAR);
  const id = String(ctx?.params?.id || '');
  if (!id) throw new ValidationError('id requerido');

  const body = await request.json().catch(() => ({}));
  const accion = String(body?.accion || '') as AccionAjuste;
  const fecha = String(body?.fecha || '').trim();
  if (accion !== 'cierre' && accion !== 'ampliacion') throw new ValidationError('Acción inválida: cierre o ampliacion.');

  if (body?.apply !== true) {
    return successResponse({ preview: true, ...(await previsualizarAjuste(id, accion, fecha)) });
  }

  const actor = {
    email: session?.user?.email || null,
    nombre: (session?.user as any)?.name || null,
  };
  const resultado = accion === 'cierre'
    ? await aplicarCierre(id, fecha, body?.motivo, actor)
    : await aplicarAmpliacion(id, fecha, body?.motivo, actor);
  return successResponse({ applied: true, ...resultado });
});
