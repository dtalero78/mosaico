/**
 * GET /api/postgres/events/graduacion-alcance?campaign=&advisor=&curso=&salon=
 *
 * Vista previa de a quién convocaría una graduación: los alumnos que ocupan cupo en
 * los salones del guía que entran en la selección (curso/salón = "Todos" o una lista
 * "A, B"). El modal lo muestra antes de guardar.
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { resolverAlcance } from '@/services/graduacion.service';

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.NUEVO_EVENTO);
  const sp = new URL(request.url).searchParams;
  const r = await resolverAlcance({
    campaign: (sp.get('campaign') || '').trim(),
    advisorId: (sp.get('advisor') || '').trim(),
    curso: sp.get('curso'),
    salon: sp.get('salon'),
  });
  return successResponse({ total: r.academicaIds.length, salones: r.salones });
});
