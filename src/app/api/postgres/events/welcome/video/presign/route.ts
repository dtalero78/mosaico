import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { ServicioPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { getPresignedPutUrl } from '@/lib/spaces';
import { VIDEO_WELCOME_PREFIJO, VIDEO_WELCOME_TIPOS, VIDEO_WELCOME_MAX_MB } from '@/lib/welcome-intentos';

/**
 * POST /api/postgres/events/welcome/video/presign
 * Body: { tipo: 'video/mp4', tamano: bytes }
 *
 * URL firmada para que el navegador suba el video nuevo DIRECTO a Spaces (un
 * archivo de decenas de MB por el servidor terminaría en 504). La subida no lo
 * deja vigente: eso lo hace `/reemplazar` después de comprobar que llegó.
 * Permiso: SERVICIO.WELCOME.VIDEO_REEMPLAZAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.WELCOME_VIDEO_REEMPLAZAR);
  const b = await request.json().catch(() => ({}));
  const tipo = String(b?.tipo || '').trim().toLowerCase();
  const tamano = Number(b?.tamano || 0);
  if (!(VIDEO_WELCOME_TIPOS as readonly string[]).includes(tipo)) {
    throw new ValidationError('El video debe ser un archivo MP4.');
  }
  if (!tamano || tamano > VIDEO_WELCOME_MAX_MB * 1024 * 1024) {
    throw new ValidationError(`El video no puede pasar de ${VIDEO_WELCOME_MAX_MB} MB.`);
  }
  const key = `${VIDEO_WELCOME_PREFIJO}video-welcome-${Date.now()}.mp4`;
  const url = await getPresignedPutUrl(key, tipo, 1800);
  return successResponse({ url, key });
});
