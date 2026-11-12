/**
 * API: /api/postgres/pagos-titulares/penalidad/[id]/pago
 *
 * POST { valorPagado, fechaPago, medioPago, banco, numeroReferencia, documentosAdjuntos,
 *        dosRecibos, nota, ... } → registra un pago de la penalidad (se aplica a las cuotas en orden).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { penalidadService } from '@/services/penalidad.service';

export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL);
  const b = await req.json();
  if (!b.fechaPago) throw new ValidationError('Fecha de pago es requerida');
  const actor = (session.user as any)?.email || 'unknown';
  // Sólo se toman los campos del pago: el servicio fija titular, cuota y marca de penalidad.
  const input = {
    valorPagado: b.valorPagado, fechaPago: b.fechaPago, fechaReporte: b.fechaReporte || null,
    medioPago: b.medioPago || null, banco: b.banco || null, numeroReferencia: b.numeroReferencia || null,
    pagoTercero: b.pagoTercero || null, idTercero: b.idTercero || null,
    documentosAdjuntos: Array.isArray(b.documentosAdjuntos) ? b.documentosAdjuntos : [],
    dosRecibos: b.dosRecibos === true, nota: b.nota || null,
  };
  const r = await penalidadService.registrarPago(ctx.params.id, input, actor);
  return successResponse(r, 201);
});
