import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/cursos-contenido/imagen-presign
 *
 * Presigned PUT para subir una imagen usada en una pregunta/respuesta de
 * evaluación. Key = evaluaciones/{curso}/{code}/{step}/{ts}-{nombre}.{ext}.
 * Devuelve además `url` = ruta del proxy para embeber en el token `![](url)`
 * (estable, sin expiración). Body: { curso, code, step, filename, contentType }.
 * Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
const safe = (s: string) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60);

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const { curso, code, step, filename, contentType } = await request.json();
  const ct = contentType || 'image/png';
  if (!/^image\//.test(ct)) throw new ValidationError('Solo se permiten imágenes');
  const ext = (ct.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '');
  const base = safe(String(filename || 'img').replace(/\.[a-z0-9]+$/i, '')) || 'img';
  const key = `evaluaciones/${safe(curso) || 'curso'}/${safe(code) || 'modulo'}/${safe(step) || 'leccion'}/${Date.now()}-${base}.${ext}`;

  const command = new PutObjectCommand({ Bucket: SPACES_BUCKET, Key: key, ContentType: ct, ACL: 'private' });
  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });
  const url = `/api/postgres/cursos-contenido/imagen?key=${encodeURIComponent(key)}`;

  return successResponse({ presignedUrl, key, url });
});
