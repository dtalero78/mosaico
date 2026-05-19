/**
 * API: /api/postgres/pagos-titulares
 *
 * GET ?idPeople=...  → lista pagos del titular
 * POST { idPeople, ... } → crea un pago nuevo
 */

import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { ValidationError } from '@/lib/errors';
import { pagosTitularesService } from '@/services/pagos-titulares.service';

export const GET = handlerWithAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const idPeople = searchParams.get('idPeople');
  if (!idPeople) throw new ValidationError('idPeople requerido');

  const pagos = await pagosTitularesService.listByPerson(idPeople);
  return successResponse({ pagos, total: pagos.length });
});

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  const body = await req.json();
  const createdBy = (session.user as any)?.email || 'unknown';
  const pago = await pagosTitularesService.create(body, createdBy);
  return successResponse({ pago }, 201);
});
