import 'server-only';
import { handler, handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { catalogoHorarios, listarHorarios, crearHorario, toggleHorario } from '@/services/horarios-curso.service';

/**
 * Catálogo de horarios por tipo de curso.
 *
 * GET                 → { catalogo: { YOJI: [...], ... } } — sólo los ACTIVOS,
 *                        para el desplegable de "Agregar curso".
 * GET ?gestion=1      → { horarios: [...] } — todos, con cuántos cursos y
 *                        alumnos usa cada uno (pantalla Académico › Horarios).
 * POST { tipoCurso, horario, orden? }  → alta
 * PATCH { id, activo }                 → activar / desactivar
 *
 * ⚠ Este catálogo NO participa en ninguna consulta de negocio: los salones se
 * siguen resolviendo por el texto de (campaign, tipoCurso, horarioCurso).
 */

export const GET = handler(async (request) => {
  const gestion = new URL(request.url).searchParams.get('gestion') === '1';
  if (!gestion) return successResponse({ catalogo: await catalogoHorarios() });
  return successResponse({ horarios: await listarHorarios() });
});

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.HORARIOS_GESTION);
  const b = await request.json().catch(() => ({}));
  const creado = await crearHorario({
    tipoCurso: b?.tipoCurso,
    horario: b?.horario,
    orden: b?.orden,
    actor: (session as any)?.user?.email || 'desconocido',
  });
  return successResponse({ horario: creado, message: `Horario ${creado.horario} disponible para ${creado.tipoCurso}.` });
});

export const PATCH = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.HORARIOS_GESTION);
  const b = await request.json().catch(() => ({}));
  const h = await toggleHorario(String(b?.id || ''), b?.activo === true);
  return successResponse({
    horario: h,
    message: h.activo
      ? `${h.horario} vuelve a ofrecerse para ${h.tipoCurso}.`
      : `${h.horario} deja de ofrecerse para ${h.tipoCurso}. Los ${h.cursos} curso(s) que ya lo usan siguen igual.`,
  });
});
