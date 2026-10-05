/**
 * API: /api/postgres/pagos-titulares/facturar-masivo
 *
 * POST { items: [{ id, numeroFactura }] }
 *   → registra la factura de varios pagos YA verificados (pestaña Facturación
 *     del Centro de Validación), cada uno con SU número. No toca el saldo.
 *   → Devuelve { ok, fail, errores[] }; un pago que falle no detiene al resto.
 *
 * Gateado por PERSON.FINANCIERA.PAGOS_FACTURAR — el mismo permiso del botón
 * Facturar de cada fila: quien puede facturar uno puede facturar varios.
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';
import { ValidationError } from '@/lib/errors';

const MAX_POR_LOTE = 200;

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_FACTURAR);

  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) throw new ValidationError('No hay pagos seleccionados.');
  if (items.length > MAX_POR_LOTE) throw new ValidationError(`Máximo ${MAX_POR_LOTE} pagos por operación.`);

  const result = await pagosTitularesService.facturarMasivo(
    items.map((i: any) => ({ id: i?.id, numeroFactura: i?.numeroFactura })),
  );
  return successResponse(result);
});
