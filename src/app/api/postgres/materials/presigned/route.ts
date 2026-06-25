import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * GET /api/postgres/materials/presigned?key=materials/...
 *
 * Generates a temporary presigned URL (10 min) for a DO Spaces key.
 * Used to feed Microsoft Office Online Viewer for PPTX/DOCX/XLSX files.
 */
export const GET = handlerWithAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (!key) throw new ValidationError('key es requerido');
  const ALLOWED_PREFIXES = ['materials/', 'fotosAdvisors/', 'fotoGuia/', 'fotos/'];
  if (!ALLOWED_PREFIXES.some(p => key.startsWith(p))) throw new ValidationError('key inválido');

  const command = new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key });
  const signedUrl = await getSignedUrl(spacesClient, command, { expiresIn: 600 });

  return successResponse({ signedUrl });
});
