import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { listarCursosAjuste } from '@/services/ajuste-curso.service';

/**
 * GET /api/postgres/campaigns/ajuste?campaign=X
 *
 * Cursos activos para la pestaña Ajuste Cursos de Campañas, con su calendario
 * REAL resumido (clases dictadas / total y fecha de la última clase), que casi
 * nunca coincide con el Final curso porque las clases que caen en festivo se
 * corren al final.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_AJUSTAR);
  const campaign = request.nextUrl.searchParams.get('campaign')?.trim() || null;
  const rows = await listarCursosAjuste(campaign);
  return successResponse({ rows });
});
