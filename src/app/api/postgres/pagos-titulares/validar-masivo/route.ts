/**
 * API: /api/postgres/pagos-titulares/validar-masivo
 *
 * POST { ids: string[], numeroFactura?, fechaValidacion? }
 *   → valida EN BLOQUE los pagos/inscripciones indicados. Omite los ya
 *     validados o inexistentes; recalcula el saldo una vez por titular.
 *   → validadoPor = session.user.email; numeroFactura y fechaValidacion se
 *     aplican a todos los seleccionados.
 *
 * Gateado por RECAUDOS.APROBACION_MASIVA (permiso de aprobación en bloque,
 * distinto del validar individual PERSON.FINANCIERA.PAGOS_VALIDAR).
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { RecaudosPermission } from '@/types/permissions';
import { pagosTitularesService } from '@/services/pagos-titulares.service';
import { ValidationError } from '@/lib/errors';

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, RecaudosPermission.APROBACION_MASIVA);

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.map((x: any) => String(x)).filter(Boolean) : [];
  if (ids.length === 0) throw new ValidationError('Debes enviar al menos un id en "ids"');
  if (ids.length > 500) throw new ValidationError('Máximo 500 por operación');

  const validadoPor = (session.user as any)?.email || 'unknown';
  const numeroFactura = (body?.numeroFactura ?? '').toString();
  const fechaValidacion = (body?.fechaValidacion ?? '').toString() || null;

  const result = await pagosTitularesService.validarMasivo(ids, validadoPor, numeroFactura, fechaValidacion);
  return successResponse(result);
});
