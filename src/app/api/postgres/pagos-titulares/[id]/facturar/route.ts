/**
 * API: /api/postgres/pagos-titulares/[id]/facturar
 *
 * POST { numeroFactura, documento? } → registra el número de factura de un pago
 *      YA validado (paso Facturación del Centro de Validación). No toca el saldo.
 *      `documento` (opcional) = archivo de la factura ya subido a Spaces
 *      ({ url, nombre?, tipo? }) que se adjunta al pago.
 *
 * numeroFactura OBLIGATORIO. Solo actúa sobre pagos con validado=true.
 * Gateado por PERSON.FINANCIERA.PAGOS_FACTURAR.
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';
import { esFacturaAdmin } from '@/lib/factura-admin';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_FACTURAR);

  const body = await req.json().catch(() => ({}));
  const numeroFactura = (body?.numeroFactura ?? '').toString();
  // "ADMIN" (factura sin número propio) lleva su propio permiso: sin esta guarda
  // bastaría escribirlo a mano en la fila para saltarse la casilla.
  if (esFacturaAdmin(numeroFactura)) await requirePermission(session, PersonPermission.PAGOS_FACTURAR_ADMIN);
  const documento = body?.documento && typeof body.documento === 'object' ? body.documento : null;
  const pago = await pagosTitularesService.facturar(ctx.params.id, numeroFactura, documento);
  return successResponse({ pago });
});
