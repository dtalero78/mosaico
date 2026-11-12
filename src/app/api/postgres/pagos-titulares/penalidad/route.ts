/**
 * API: /api/postgres/pagos-titulares/penalidad  (Pago Especial › Última Penalidad)
 *
 * GET ?idPeople=...  → penalidad activa, historial y si se puede crear otra (máx. 2 por contrato)
 * POST { idPeople, valorPenalidad, numCuotas, primeraFecha, fechas?, nota } → aprueba el plan
 */
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { penalidadService } from '@/services/penalidad.service';

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_VER);
  const idPeople = new URL(req.url).searchParams.get('idPeople');
  if (!idPeople) throw new ValidationError('idPeople requerido');
  return successResponse(await penalidadService.estado(idPeople));
});

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, PersonPermission.PAGOS_REGISTRAR);
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL);
  await requirePermission(session, PersonPermission.PAGO_ESPECIAL_PENALIDAD);
  const b = await req.json();
  if (!b.idPeople) throw new ValidationError('idPeople requerido');
  const actor = (session.user as any)?.email || 'unknown';
  const plan = await penalidadService.activar(b.idPeople, {
    valorPenalidad: b.valorPenalidad, numCuotas: b.numCuotas, primeraFecha: b.primeraFecha,
    fechas: Array.isArray(b.fechas) ? b.fechas : undefined, nota: b.nota,
  }, actor);
  return successResponse({ plan }, 201);
});
