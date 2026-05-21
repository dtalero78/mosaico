import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { executeBloqueo } from '@/services/bloqueo-contrato.service';
import { ValidationError } from '@/lib/errors';

/**
 * POST /api/admin/bloqueo-contrato/execute
 * Body: { personIds: string[] }
 *
 * Ejecuta el bloqueo (UPDATE PEOPLE + ACADEMICA + USUARIOS_ROLES) para los
 * IDs recibidos. Los IDs deben provenir de un lookup previo confirmado por el
 * usuario en UI.
 */
export const POST = handlerWithAuth(async (request) => {
  const body = await request.json();
  const personIds = body?.personIds;

  if (!Array.isArray(personIds) || personIds.length === 0) {
    throw new ValidationError('Campo "personIds" debe ser un array no vacío');
  }
  if (personIds.some((id: any) => typeof id !== 'string')) {
    throw new ValidationError('Todos los personIds deben ser strings');
  }

  const result = await executeBloqueo(personIds);
  return successResponse(result);
});
