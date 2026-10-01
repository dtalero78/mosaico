import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { spacesClient, SPACES_BUCKET, SPACES_CDN } from '@/lib/spaces';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { documentoPermitido, MAX_MB_DOCUMENTO } from '@/lib/documentos-adjuntos';
import { reciboPermitido, MAX_MB_RECIBO } from '@/lib/recibo-inscripcion';

/**
 * POST — sube un archivo del contrato a DO Spaces (a través de la API para evitar CORS).
 *
 * Exige sesión: antes no pedía ninguna, y como el middleware no cubre `/api`,
 * cualquiera en internet podía subir archivos a nombre de un titular. Los que la
 * usan (documentación, recibo, adjuntos de pagos y facturas) son pantallas del
 * panel; cada una aplica después su propio permiso al registrar el archivo.
 *
 * Campo opcional `proposito=recibo`: valida con las reglas del recibo de
 * inscripción (imagen o PDF, máx. 15 MB — lo que la lectura con IA puede leer).
 */
export const POST = handlerWithAuth(async (request, { params }) => {
  const titularId = params.id;
  const existe = await queryOne(`SELECT 1 FROM "PEOPLE" WHERE "_id" = $1`, [titularId]);
  if (!existe) throw new NotFoundError('Titular', titularId);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const esRecibo = formData.get('proposito') === 'recibo';

  if (!file) throw new ValidationError('file requerido');
  if (esRecibo) {
    if (!reciboPermitido(file.type, file.name)) {
      throw new ValidationError(`El recibo debe ser una imagen JPG, PNG o WEBP, o un PDF (${file.name}).`);
    }
  } else if (!documentoPermitido(file.type, file.name)) {
    // Se mira el tipo Y la extensión: el navegador etiqueta las notas de voz de
    // formas distintas según el sistema, y algunas llegan sin tipo.
    throw new ValidationError(
      `Tipo no permitido: ${file.type || 'desconocido'} (${file.name}). `
      + 'Use JPG, PNG, WEBP, HEIC, PDF o un audio (MP3, M4A, OGG, WAV…).'
    );
  }
  const maxMb = esRecibo ? MAX_MB_RECIBO : MAX_MB_DOCUMENTO;
  if (file.size > maxMb * 1024 * 1024) {
    throw new ValidationError(`Archivo demasiado grande: máximo ${maxMb}MB`);
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
