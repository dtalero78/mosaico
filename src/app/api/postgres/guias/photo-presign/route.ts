import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';

/**
 * POST /api/postgres/guias/photo-presign
 *
 * Returns a presigned PUT URL so the advisor can upload their photo
 * directly to DO Spaces (fotosAdvisors/{advisorId}.ext).
 * Resolves advisorId from session email — client doesn't need to send it.
 *
 * Body: { contentType }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  const { contentType } = await request.json();
  const sessionEmail = session.user?.email;
  if (!sessionEmail) throw new ValidationError('No se encontró email en la sesión');

  // Resolve real advisor _id from session email
  const advisor = await queryOne<{ _id: string }>(
    `SELECT "_id" FROM "GUIAS" WHERE LOWER("email") = LOWER($1) LIMIT 1`,
    [sessionEmail]
  );
  if (!advisor) throw new NotFoundError('Advisor', sessionEmail);

  const ext = (contentType || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const key = `fotosAdvisors/${advisor._id}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    ContentType: contentType || 'image/jpeg',
    ACL: 'private',
  });

  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });

  return successResponse({ presignedUrl, key });
});
