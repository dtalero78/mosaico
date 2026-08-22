import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { eliminarFestivo } from '@/services/festivos-personalizados.service';

/**
 * DELETE /api/postgres/academic/festivos/[id] — quita un festivo declarado.
 *
 * No regenera los cursos: el día vuelve a estar disponible, pero las clases se
 * recolocan al regenerar (botón aparte), que es una operación pesada y con
 * consecuencias — el admin decide cuándo.
 */
export const DELETE = handlerWithAuth(async (_request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const r = await eliminarFestivo(params.id);
  return successResponse(r);
});
