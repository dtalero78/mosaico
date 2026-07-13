import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { cambiarCursoAcademico } from '@/services/cambio-academico.service'

/**
 * POST /api/postgres/students/[id]/cambio-academico
 *
 * Mueve un beneficiario de campaña/curso/salón (Cambio Académico). [id] = ACADEMICA._id.
 * Body: { campaign, tipoCurso, horarioCurso, salon, motivo }.
 * Gateado por STUDENT.ACADEMIA.CAMBIO_ACADEMICO (SUPER_ADMIN/ADMIN bypass).
 */
export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, StudentPermission.CAMBIO_ACADEMICO)

  const body = await req.json()
  const actor = {
    email: session.user?.email || null,
    nombre: (session.user as any)?.name || null,
  }
  const result = await cambiarCursoAcademico(params.id, body, actor)
  return successResponse({ message: 'Cambio académico aplicado', ...result })
})
