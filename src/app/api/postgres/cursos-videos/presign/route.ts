import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ValidationError } from '@/lib/errors';

const slug = (s: string) =>
  String(s || '').trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

/**
 * POST /api/postgres/cursos-videos/presign
 *
 * Presigned PUT para subir el video (MP4) de una lección a DO Spaces, scopeado
 * por curso+módulo+lección para no colisionar (en MOSAICO el `code` se repite
 * entre cursos). Key = videos/cursos/{curso}/{code}/{step}.mp4 (re-subir sobreescribe).
 * Body: { curso, code, step, contentType? }. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const { curso, code, step, contentType } = await request.json();
  if (!curso || !code || !step) throw new ValidationError('curso, code y step son requeridos');

  const key = `videos/cursos/${slug(curso)}/${slug(code)}/${slug(step)}.mp4`;
  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    ContentType: contentType || 'video/mp4',
    ACL: 'private',
  });
  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 900 });

  return successResponse({ presignedUrl, key });
});
