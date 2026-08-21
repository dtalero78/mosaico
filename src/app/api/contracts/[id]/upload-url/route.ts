import 'server-only';
import { handler, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { spacesClient, SPACES_BUCKET, SPACES_CDN } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { documentoPermitido, MAX_MB_DOCUMENTO } from '@/lib/documentos-adjuntos';

const MAX_SIZE_MB = MAX_MB_DOCUMENTO;

// POST — Upload file to DO Spaces (proxied through API to avoid CORS)
export const POST = handler(async (request, { params }) => {
  const titularId = params.id;
  const formData = await request.formData();
  const file = formData.get('file') as File | null;

  if (!file) throw new ValidationError('file requerido');
  // Se mira el tipo Y la extensión: el navegador etiqueta las notas de voz de
  // formas distintas según el sistema, y algunas llegan sin tipo.
  if (!documentoPermitido(file.type, file.name)) {
    throw new ValidationError(
      `Tipo no permitido: ${file.type || 'desconocido'} (${file.name}). `
      + 'Use JPG, PNG, WEBP, HEIC, PDF o un audio (MP3, M4A, OGG, WAV…).'
    );
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new ValidationError(`Archivo demasiado grande: máximo ${MAX_SIZE_MB}MB`);
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `contratos/${titularId}/${Date.now()}-${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  await spacesClient.send(new PutObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: file.type,
    ACL: 'public-read',
  }));

  const publicUrl = `${SPACES_CDN}/${key}`;
  return successResponse({ publicUrl, key });
});
