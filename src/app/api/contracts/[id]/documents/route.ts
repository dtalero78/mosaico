import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { queryOne } from '@/lib/postgres';
import { requireAnyPermission, requirePermission } from '@/lib/api-permissions';
import { ComercialPermission, PersonPermission } from '@/types/permissions';
import { spacesClient, SPACES_BUCKET } from '@/lib/spaces';
import { keyDeNuestroBucket } from '@/services/recibo-inscripcion.service';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Documentación del contrato (PEOPLE.documentacion).
 *
 * Antes no pedía sesión: cualquiera en internet podía listar, agregar o BORRAR
 * documentos de un titular. Ahora:
 *   GET    — ver la documentación (o poder subirla, o editar el contrato, o ver pagos)
 *   POST   — PERSON.INFO.ADICION_DOCUMENTACION
 *   DELETE — PERSON.INFO.ELIMINAR_DOCUMENTACION (sembrado a quien editaba contratos)
 */

// POST — append a document to PEOPLE.documentacion
export const POST = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.ADICION_DOCUMENTACION);
  const titularId = params.id;
  const { url, nombre, tipo } = await request.json();

  if (!url || !nombre) throw new ValidationError('url y nombre son requeridos');

  const titular = await queryOne(`SELECT "_id" FROM "PEOPLE" WHERE "_id" = $1`, [titularId]);
  if (!titular) throw new NotFoundError('Titular', titularId);

  const doc = { url, nombre, tipo: tipo || 'application/octet-stream', fechaSubida: new Date().toISOString() };

  await queryOne(
    `UPDATE "PEOPLE"
     SET "documentacion" = COALESCE("documentacion", '[]'::jsonb) || $1::jsonb
     WHERE "_id" = $2`,
    [JSON.stringify([doc]), titularId]
  );

  // Return updated list
  const updated = await queryOne(`SELECT "documentacion" FROM "PEOPLE" WHERE "_id" = $1`, [titularId]);
  return successResponse({ documentacion: updated?.documentacion || [] });
});

// DELETE — remove a document by URL from PEOPLE.documentacion and from Spaces
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, PersonPermission.ELIMINAR_DOCUMENTACION);
  const titularId = params.id;
  const { url } = await request.json();
  if (!url) throw new ValidationError('url requerida');

  const titular = await queryOne(
    `SELECT "documentacion" FROM "PEOPLE" WHERE "_id" = $1`,
    [titularId]
  );
  if (!titular) throw new NotFoundError('Titular', titularId);

  const docs: any[] = titular.documentacion || [];
  if (!docs.some((d: any) => d?.url === url)) throw new NotFoundError('Documento', url);
  const filtered = docs.filter((d: any) => d.url !== url);

  await queryOne(
    `UPDATE "PEOPLE" SET "documentacion" = $1::jsonb WHERE "_id" = $2`,
    [JSON.stringify(filtered), titularId]
  );

  // Se borra de Spaces sólo si es de NUESTRO bucket y era de este titular: sin la
  // verificación de arriba, mandar una URL cualquiera borraba ese objeto.
  const key = keyDeNuestroBucket(url);
  if (key) {
    try {
      await spacesClient.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    } catch { /* la BD es la fuente de verdad */ }
  }

  return successResponse({ documentacion: filtered });
});

// GET — fetch current documentacion list
export const GET = handlerWithAuth(async (_request, { params }, session) => {
  await requireAnyPermission(session, [
    PersonPermission.VER_DOCUMENTACION,
    PersonPermission.ADICION_DOCUMENTACION,
    ComercialPermission.MODIFICAR_CONTRATO,
    PersonPermission.PAGOS_VER,
  ]);
  const titularId = params.id;
  const row = await queryOne(`SELECT "documentacion" FROM "PEOPLE" WHERE "_id" = $1`, [titularId]);
  if (!row) throw new NotFoundError('Titular', titularId);
  return successResponse({ documentacion: row.documentacion || [] });
});
