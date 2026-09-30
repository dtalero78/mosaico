import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission, tienePermiso } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { getVideoConfig, listarCandidatos, enlaceVideoWelcome } from '@/services/welcome-video.service';
import { getPresignedGetUrl } from '@/lib/spaces';

/**
 * GET /api/postgres/events/welcome/video
 *
 * Pestaña "Video Welcome": el video vigente (con una URL temporal para verlo) y
 * los alumnos que faltaron a su segunda bienvenida, cada uno con su última
 * sesión perdida, el número al que iría el video y su último envío.
 *
 * Permiso: SERVICIO.WELCOME.VIDEO_VER. Dice además si puede reemplazar el video.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.WELCOME_VIDEO_VER);
  const [cfg, alumnos] = await Promise.all([getVideoConfig(), listarCandidatos()]);
  return successResponse({
    video: cfg ? { ...cfg, previewUrl: await getPresignedGetUrl(cfg.key, 3600) } : null,
    enlace: enlaceVideoWelcome(),
    alumnos,
    total: alumnos.length,
    puedeReemplazar: await tienePermiso(session, ServicioPermission.WELCOME_VIDEO_REEMPLAZAR),
  });
});
