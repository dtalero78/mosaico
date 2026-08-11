/**
 * POST /api/admin/envio-mensajes/presign
 *
 * Devuelve una URL de subida (presigned PUT) para adjuntar UN archivo (imagen /
 * video / documento) a un envío masivo de WhatsApp. El navegador sube el archivo
 * directo a DO Spaces con esa URL y luego manda la `key` a /send.
 *
 * Body: { filename: string, contentType: string, size: number }
 * → { key, uploadUrl }
 *
 * Permiso: MANTENIMIENTO.USUARIOS.ENVIO_MENSAJES (SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { MantenimientoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { getPresignedPutUrl } from '@/lib/spaces';

// Tope duro de tamaño (los videos grandes fallan o arriesgan el bloqueo de la línea).
const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16 MB

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.ENVIO_MENSAJES);

  const body = await request.json();
  const filename = String(body?.filename || '').trim();
  const contentType = String(body?.contentType || '').trim() || 'application/octet-stream';
  const size = Number(body?.size) || 0;

  if (!filename) throw new ValidationError('filename requerido');
  if (size > MAX_FILE_BYTES) {
    throw new ValidationError(`El archivo supera el máximo de 16 MB (${(size / 1024 / 1024).toFixed(1)} MB).`);
  }

  // Nombre seguro para la key + prefijo con timestamp para evitar colisiones.
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const key = `envio-mensajes/${Date.now()}-${safe}`;

  const uploadUrl = await getPresignedPutUrl(key, contentType, 600);
  return successResponse({ key, uploadUrl });
});
