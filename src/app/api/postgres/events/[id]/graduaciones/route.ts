/**
 * Graduaciones conjuntas.
 *  GET    → { grupo, unibles }: las enlazadas con ésta y las que se le pueden unir.
 *  POST   { eventIds } → une esas graduaciones a ésta (misma fecha, hora, duración y Zoom).
 *  DELETE ?quitar=<id> → saca una graduación del grupo (por defecto, ésta misma).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { graduacionesParaUnir, unirGraduaciones, separarGraduacion } from '@/services/graduacion.service';

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.EDITAR);
  return successResponse(await graduacionesParaUnir(params.id));
});

export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.EDITAR);
  const body = await req.json().catch(() => ({}));
  const r = await unirGraduaciones(params.id, body.eventIds || [], { actor: (session?.user as any)?.email || 'sistema' });
  return successResponse({ ...r, ...(await graduacionesParaUnir(params.id)) });
});

export const DELETE = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, AcademicoPermission.EDITAR);
  const quitar = new URL(req.url).searchParams.get('quitar') || params.id;
  await separarGraduacion(quitar);
  return successResponse(await graduacionesParaUnir(params.id));
});
