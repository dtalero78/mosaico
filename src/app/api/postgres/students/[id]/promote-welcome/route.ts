import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { promoteFromWelcome, previewPromoteFromWelcome } from '@/services/student.service'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'

/**
 * GET /api/postgres/students/[id]/promote-welcome
 *
 * Preview (solo lectura) del curso real al que se promovería — alimenta el modal de
 * confirmación con el nombre del beneficiario y el curso destino.
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, StudentPermission.APROBAR_WELCOME)
  const preview = await previewPromoteFromWelcome(params.id)
  return successResponse(preview)
})

/**
 * POST /api/postgres/students/[id]/promote-welcome
 *
 * [id] = ACADEMICA._id. Promueve al estudiante desde el curso puente WELCOME a su
 * curso REAL, copiando campaña/curso/salón/módulo/lección desde PEOPLE a ACADEMICA.
 * Gateado por STUDENT.ACADEMIA.APROBAR_WELCOME (SUPER_ADMIN/ADMIN bypass).
 */
export const POST = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, StudentPermission.APROBAR_WELCOME)
  const academicaId = params.id
  const actor = {
    email: (session.user as any)?.email,
    nombre: (session.user as any)?.name,
  }
  const result = await promoteFromWelcome(academicaId, actor)
  return successResponse({ ...result, message: 'Estudiante promovido a su curso' })
})
