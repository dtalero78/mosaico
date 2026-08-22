import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ValidationError } from '@/lib/errors';
import { cursosDeFechas, regenerarUnCurso } from '@/services/festivos-personalizados.service';

/**
 * Recolocar las clases que caen en un festivo declarado.
 *
 * GET  ?fechas=a,b,c  → los cursos a regenerar (id + nombre), para que la página
 *                       los recorra de a uno y muestre el avance.
 * POST { cursoId }    → regenera UN curso.
 *
 * Va curso por curso a propósito: regenerar uno solo ya reescribe sus eventos y
 * todos los agendamientos de sus alumnos, y en una sola petición para ochenta
 * cursos el navegador se rinde antes de terminar. Así además, si algo falla, se
 * sabe exactamente en cuál.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const raw = new URL(request.url).searchParams.get('fechas') || '';
  const fechas = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!fechas.length) throw new ValidationError('Indica al menos una fecha.');
  if (fechas.length > 40) throw new ValidationError('Máximo 40 fechas por operación.');
  return successResponse({ cursos: await cursosDeFechas(fechas) });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.FESTIVOS_GESTION);
  const body = await request.json().catch(() => ({}));
  const cursoId = String(body?.cursoId || '').trim();
  if (!cursoId) throw new ValidationError('Falta el curso a regenerar.');
  return successResponse(await regenerarUnCurso(cursoId));
});
