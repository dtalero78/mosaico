import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { leerPerfilEstudiante, actualizarPerfilEstudiante } from '@/services/perfil-estudiante.service'

/**
 * /api/postgres/students/[id]/perfil   (id = ACADEMICA._id, el de /student/[id])
 *
 * GET → el perfil del alumno (lo mismo que ve en "Mi Perfil" de su panel).
 * PUT → guarda nombres, correo, celular, nacimiento, domicilio, ciudad y foto en
 *       ACADEMICA, PEOPLE y su cuenta de acceso. El documento no se edita.
 * Gateado por STUDENT.GLOBAL.EDITAR_PERFIL (SUPER_ADMIN/ADMIN pasan por bypass).
 */
export const GET = handlerWithAuth(async (_req, { params }: { params: Record<string, string> }, session) => {
  await requirePermission(session, StudentPermission.EDITAR_PERFIL)
  return successResponse({ perfil: await leerPerfilEstudiante(params.id) })
})

export const PUT = handlerWithAuth(async (request, { params }: { params: Record<string, string> }, session) => {
  await requirePermission(session, StudentPermission.EDITAR_PERFIL)
  const body = await request.json().catch(() => ({}))
  const user: any = (session as any)?.user || {}
  const r = await actualizarPerfilEstudiante(params.id, body || {}, {
    email: user.email || 'desconocido',
    nombre: user.name || user.email || '',
  })
  return successResponse(r)
})
