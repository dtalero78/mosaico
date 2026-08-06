import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { StudentPermission } from '@/types/permissions';
import { AppConfigRepository } from '@/repositories/config.repository';

/**
 * Config: visibilidad de la caja "Extensión de Vigencia" en /student/[id] › Contrato.
 * GET  → { visible } (default true). POST → activa/oculta (gate EXTENDER_VIGENCIA).
 */
const KEY = 'extension_vigencia_visible';

export const GET = handlerWithAuth(async () => {
  const row = await AppConfigRepository.get(KEY);
  return successResponse({ visible: row ? row.value !== 'false' : true });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, StudentPermission.EXTENDER_VIGENCIA);
  const body = await request.json().catch(() => ({}));
  const visible = body?.visible === true || body?.visible === 'true';
  const email = (session?.user as any)?.email || 'admin';
  await AppConfigRepository.set(KEY, visible ? 'true' : 'false', '#ffffff', email);
  return successResponse({ visible });
});
