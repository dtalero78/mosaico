import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { reemplazarVideo } from '@/services/welcome-video.service';

/**
 * POST /api/postgres/events/welcome/video/reemplazar
 * Body: { key, nombre, tamano }
 *
 * Deja como vigente el video recién subido (comprueba que exista en Spaces) y
 * borra el anterior. El enlace que se envía no cambia: desde ahora muestra el
 * nuevo. Permiso: SERVICIO.WELCOME.VIDEO_REEMPLAZAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.WELCOME_VIDEO_REEMPLAZAR);
  const b = await request.json().catch(() => ({}));
  const user = (session?.user as any) || {};
  const video = await reemplazarVideo(
    { key: b?.key, nombre: b?.nombre, tamano: Number(b?.tamano) || null },
    { email: user.email || 'desconocido', nombre: user.name || null },
  );
  return successResponse({ video });
});
