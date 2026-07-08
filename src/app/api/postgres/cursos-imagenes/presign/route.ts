import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ValidationError } from '@/lib/errors';
import { TIPOS_CURSO } from '@/lib/cursos-campaign';

/**
 * POST /api/postgres/cursos-imagenes/presign
 *
 * Presigned PUT para subir la imagen de un tipo de curso a la carpeta Cursos/
 * del bucket de MOSAICO. Key = Cursos/{tipoCurso}.{ext} (re-subir sobreescribe).
 * Body: { tipoCurso, contentType }. Gateado por ACADEMICO.MATERIAL.ACTUALIZAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.ACTUALIZAR_MATERIAL);

  const { tipoCurso, contentType } = await request.json();
  if (!(TIPOS_CURSO as readonly string[]).includes(tipoCurso)) {
    throw new ValidationError(`tipoCurso inválido: ${tipoCurso}`);
  }
  const ct = contentType || 'image/jpeg';
  const ext = (ct.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('+xml', '');
  const key = `Cursos/${tipoCurso}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    ContentType: ct,
    ACL: 'private',
  });
  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });

  return successResponse({ presignedUrl, key });
});
