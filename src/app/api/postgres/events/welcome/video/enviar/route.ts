import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { enviarVideo } from '@/services/welcome-video.service';

/**
 * POST /api/postgres/events/welcome/video/enviar
 * Body: { academicaIds: string[] }  (1 a 60 — de a uno o en bloque)
 *
 * Envía por WhatsApp el enlace al video de bienvenida y promueve al alumno de
 * WELCOME a su curso. Sólo a quienes ESTÁN en la pestaña (se recalcula en el
 * servidor). Quién envía sale de la sesión. Permiso: SERVICIO.WELCOME.VIDEO_VER.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.WELCOME_VIDEO_VER);
  const b = await request.json().catch(() => ({}));
  const user = (session?.user as any) || {};
  const r = await enviarVideo(Array.isArray(b?.academicaIds) ? b.academicaIds : [], {
    email: user.email || 'desconocido',
    nombre: user.name || null,
  });
  return successResponse(r);
});
