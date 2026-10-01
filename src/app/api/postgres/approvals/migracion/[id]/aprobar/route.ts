import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AprobacionPermission } from '@/types/permissions';
import { aprobarContratoMigrado } from '@/services/migracion-aprobacion.service';

/**
 * POST /api/postgres/approvals/migracion/[id]/aprobar   ([id] = titular PEOPLE._id)
 * Body: { enviarWhatsApp?: boolean }   (por defecto NO se envía)
 *
 * Aprueba UN contrato migrado: firma automática si falta, «dejar listo» si
 * falta, aprobación con sólo clases futuras, alumno a la lección de su salón,
 * PDF de nuevo en Drive y el WhatsApp de bienvenida sólo si se pide. La
 * pantalla llama a este endpoint contrato por contrato — los PDF se generan de
 * uno en uno y así cada contrato devuelve su propio resultado.
 */
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AprobacionPermission.MIGRACION_APROBAR);
  const body = await request.json().catch(() => ({}));

  const ip = (request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || request.headers.get('x-real-ip') || 'unknown').slice(0, 45);
  const resultado = await aprobarContratoMigrado(params.id, {
    enviarWhatsApp: body?.enviarWhatsApp === true,
    actorEmail: (session.user as any)?.email || 'system@mosaico.com',
    actorNombre: (session.user as any)?.name || 'System',
    ip,
    userAgent: request.headers.get('user-agent') || 'unknown',
  });
  return successResponse({ resultado });
});
