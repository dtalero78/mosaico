import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { eliminarFestivo } from '@/services/festivos-personalizados.service';
import { restablecerFestivoImpulsa } from '@/services/festivos-impulsa.service';

/**
 * DELETE /api/postgres/academic/festivos/[id] — quita un festivo declarado.
 *
 * No regenera los cursos: devuelve los que hay que restablecer (los de su alcance cuyo
 * calendario cruza el día) para que la página los recorra de a uno con avance.
 */
export const DELETE = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  // Body opcional: { cursoIds } para quitar el festivo sólo de algunos cursos (alcance CURSOS).
  const body = await request.json().catch(() => ({}));
  const r = await eliminarFestivo(params.id, Array.isArray(body?.cursoIds) ? body.cursoIds : undefined);
  // IMPULSA: devuelve cada clase corrida a su día original (sin regenerar el curso).
  const impulsa = r.alcance === 'IMPULSA' ? await restablecerFestivoImpulsa(r.movimientos as any[]) : undefined;
  return successResponse({ ...r, impulsa });
});
