import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/postgres/advisors/photo-presign-public
 *
 * Public presigned PUT URL for guía photo during registration (/nuevo-guia).
 * No auth required since /nuevo-guia is a public page.
 * Uses a temp key (fotosAdvisors/new_{timestamp}.ext) — the create endpoint
 * references this key in GUIAS.fotoAdvisor after creation.
 *
 * Body: { tempKey, contentType }
 */
export const POST = handler(async (request) => {
  const { tempKey, contentType } = await request.json();

  if (!tempKey?.startsWith('fotosAdvisors/')) throw new ValidationError('key inválido');

  const command = new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: tempKey,
    ContentType: contentType || 'image/jpeg',
    ACL: 'private',
  });

  const presignedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });

  return successResponse({ presignedUrl, key: tempKey });
});
