import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { seguimientoContrato, comentarSeguimiento } from '@/services/seguimiento-contrato.service';

/**
 * GET  /api/postgres/people/[id]/seguimiento  → bitácora del contrato de la persona (titular o
 *      beneficiario → su contrato completo). Gate: PERSON.INFO.SEGUIMIENTO.
 * POST /api/postgres/people/[id]/seguimiento  Body: { texto, personaId? } → comentario en el
 *      Seguimiento (CONTRATO_EVENTOS, inmutable). Gate: + PERSON.INFO.SEGUIMIENTO_COMENTAR.
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, PersonPermission.SEGUIMIENTO);
  return successResponse(await seguimientoContrato(params.id));
});

export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, PersonPermission.SEGUIMIENTO);
  await requirePermission(session, PersonPermission.SEGUIMIENTO_COMENTAR);
  const body = await req.json().catch(() => ({}));
  await comentarSeguimiento(params.id, body?.texto, body?.personaId, session);
  return successResponse(await seguimientoContrato(params.id));
});
