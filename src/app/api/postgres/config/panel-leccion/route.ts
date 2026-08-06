import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { AppConfigRepository } from '@/repositories/config.repository';

/**
 * Config: visibilidad de la caja "Lección ##" en el panel del estudiante (IMPULSA).
 *
 * GET  → { visible: boolean }  (default true si no está seteado). Autenticado; lo lee el panel.
 * POST → { visible }  activa/desactiva. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR
 *        (mismo permiso que Mantenimiento Cursos › Contenido).
 */
const KEY = 'panel_leccion_visible';

export const GET = handlerWithAuth(async () => {
  const row = await AppConfigRepository.get(KEY);
  const visible = row ? row.value !== 'false' : true;
  return successResponse({ visible });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);
  const body = await request.json().catch(() => ({}));
  const visible = body?.visible === true || body?.visible === 'true';
  const email = (session?.user as any)?.email || 'admin';
  await AppConfigRepository.set(KEY, visible ? 'true' : 'false', '#ffffff', email);
  return successResponse({ visible });
});
