import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { unirCursosEnGrupo, deshacerGrupo, colisionesDeCampania } from '@/services/grupo-horario.service';

/**
 * Grupos de salón: hasta 3 cursos de la misma campaña con el mismo guía y el
 * mismo horario. El guía dicta una sola sesión; la asistencia se marca por curso.
 *
 * GET    ?campaign=X   → colisiones de guía de la campaña + grupos ya declarados
 * POST   { cursoIds }  → une 2 o 3 cursos en un grupo (y regenera sus eventos)
 * DELETE ?grupo=X | ?curso=Y → deshace el grupo o saca un curso de él
 *
 * Todo pasa por `ACADEMICO.CAMPANA.CREAR`, el mismo permiso que gestiona cursos.
 */

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const campaign = new URL(request.url).searchParams.get('campaign') || '';
  if (!campaign.trim()) throw new ValidationError('Falta el parámetro campaign.');
  return successResponse(await colisionesDeCampania(campaign));
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const body = await request.json().catch(() => ({}));
  const cursoIds: string[] = Array.isArray(body?.cursoIds) ? body.cursoIds : [];
  return successResponse(await unirCursosEnGrupo(cursoIds));
});

export const DELETE = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.CAMPANA_CREAR);
  const sp = new URL(request.url).searchParams;
  const grupoHorarioId = sp.get('grupo') || undefined;
  const cursoId = sp.get('curso') || undefined;
  return successResponse(await deshacerGrupo({ grupoHorarioId, cursoId }));
});
