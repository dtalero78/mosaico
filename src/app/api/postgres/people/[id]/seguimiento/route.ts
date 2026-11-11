import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { PersonPermission } from '@/types/permissions';
import { seguimientoContrato, comentarSeguimiento, etiquetasPermitidas } from '@/services/seguimiento-contrato.service';

/**
 * GET  /api/postgres/people/[id]/seguimiento  → bitácora del contrato de la persona (titular o
 *      beneficiario → su contrato completo) + las etiquetas de comentario que puede usar quien
 *      consulta. Gate: PERSON.INFO.SEGUIMIENTO.
 * POST /api/postgres/people/[id]/seguimiento  Body: { texto, personaId?, etiqueta? } → comentario
 *      en el Seguimiento (CONTRATO_EVENTOS, inmutable). Gate: + PERSON.INFO.SEGUIMIENTO_COMENTAR.
 *      etiqueta = SOBRE_APROBACION (Aprobación) | PARA_APROBACION (ejecutivo del contrato o director).
 */
const conEtiquetas = async (id: string, session: any) => {
  const [s, etiquetas] = await Promise.all([seguimientoContrato(id), etiquetasPermitidas(id, session)]);
  return { ...s, etiquetasPermitidas: etiquetas };
};

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, PersonPermission.SEGUIMIENTO);
  return successResponse(await conEtiquetas(params.id, session));
});

export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, PersonPermission.SEGUIMIENTO);
  await requirePermission(session, PersonPermission.SEGUIMIENTO_COMENTAR);
  const body = await req.json().catch(() => ({}));
  await comentarSeguimiento(params.id, body?.texto, body?.personaId, session, body?.etiqueta || undefined);
  return successResponse(await conEtiquetas(params.id, session));
});
