import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { listarCuestionariosCurso } from '@/services/ver-cuestionarios.service'

/**
 * GET /api/postgres/academic/cuestionarios?tipo=evaluacion|entrenamiento&curso=X
 *
 * Cuestionarios de un curso agrupados por módulo, CON respuestas correctas
 * (Académico › Guías › Ver Evaluación / Ver Entrenamiento). Cada tipo exige su
 * permiso: ver los entrenamientos no da acceso a las evaluaciones.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  const sp = new URL(request.url).searchParams
  const tipo = sp.get('tipo') === 'entrenamiento' ? 'entrenamiento' : 'evaluacion'
  await requirePermission(session, tipo === 'evaluacion'
    ? AcademicoPermission.VER_EVALUACION
    : AcademicoPermission.VER_ENTRENAMIENTO)
  return successResponse(await listarCuestionariosCurso(session, tipo, sp.get('curso') || ''))
})
