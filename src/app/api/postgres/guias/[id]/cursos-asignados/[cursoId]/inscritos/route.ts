/**
 * GET /api/postgres/guias/[id]/cursos-asignados/[cursoId]/inscritos
 *   [id] = GUIAS._id · [cursoId] = CURSOS_CAMPAIGN._id
 *
 * Inscritos de un curso del guía (Panel Guía › Cursos asignados, clic en el
 * globo de inscritos). Misma consulta que Académico › Campañas.
 *
 * Alcance (devuelve nombres y documentos de alumnos, así que se valida en el servidor):
 *  - el curso tiene que estar asignado a ESE guía;
 *  - rol GUIA → sólo su propio panel (resuelto por su correo, no por el id del navegador);
 *  - otros roles → el permiso con el que se entra al panel de otro guía
 *    (`ACADEMICO.ADVISOR.VER_ENLACE`; SUPER_ADMIN/ADMIN bypass).
 */
import 'server-only';
import { handlerWithAuth, successResponse } from '@/lib/api-helpers';
import { requirePermission } from '@/lib/api-permissions';
import { AcademicoPermission } from '@/types/permissions';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { esRolGuia, guiaIdDeSesion } from '@/services/guia-sesion.service';
import { listarInscritosCurso } from '@/services/inscritos-curso.service';

export const GET = handlerWithAuth(async (_req, { params }, session) => {
  if (esRolGuia(session)) {
    const propio = await guiaIdDeSesion((session as any)?.user?.email);
    if (!propio || propio !== params.id) throw new ForbiddenError('Sólo puedes ver los inscritos de tus propios cursos');
  } else {
    await requirePermission(session, AcademicoPermission.ADVISOR_VER_ENLACE);
  }

  const { curso, total, items } = await listarInscritosCurso(params.cursoId);
  if (curso.guia !== params.id) throw new NotFoundError('Curso asignado al guía', params.cursoId);

  return successResponse({
    curso: { campaign: curso.campaign, tipoCurso: curso.tipoCurso, horarioCurso: curso.horarioCurso, salon: curso.salon },
    total,
    items,
  });
});
