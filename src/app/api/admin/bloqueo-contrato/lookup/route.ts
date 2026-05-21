import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { lookupByContrato } from '@/services/bloqueo-contrato.service';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/admin/bloqueo-contrato/lookup
 * Body: { contrato: string }
 *
 * Busca titular + beneficiarios y devuelve qué se va a bloquear / saltar.
 * NO modifica datos.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();
  const contrato = body?.contrato;

  if (typeof contrato !== 'string' || !contrato.trim()) {
    throw new ValidationError('Campo "contrato" es obligatorio');
  }

  const result = await lookupByContrato(contrato);
  return successResponse(result);
});
