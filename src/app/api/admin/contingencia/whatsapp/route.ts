import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { checkWhatsAppHealth } from '@/lib/whatsapp';

/**
 * Monitoreo del canal de WhatsApp (Mantenimiento › Contingencia › WhatsApp).
 *   GET → estado en vivo de la línea (Whapi /health). Nunca expone el token.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CONTINGENCIA_WHATSAPP);
  const canal = await checkWhatsAppHealth();
  return successResponse({ canal });
});
