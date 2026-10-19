/**
 * API: /api/postgres/pagos-titulares/[id]/leer-documento
 *
 * POST { url } → lee la boleta/factura recién adjuntada (ya subida a Spaces) y
 *   devuelve el número con prefijo (B-69351 / F-246), el monto, el RUT del
 *   receptor y los avisos contra el pago. NO guarda nada: el número se propone y
 *   lo confirma quien factura.
 *
 * Gateado por PERSON.FINANCIERA.PAGOS_FACTURAR — es parte de facturar.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { leerDocumentoDePago } from '@/services/lectura-documento-tributario.service';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_FACTURAR);
  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || '').trim();
  if (!url) throw new ValidationError('Falta el archivo a leer.');
  const lectura = await leerDocumentoDePago(ctx.params.id, url);
  return successResponse({ lectura });
});
