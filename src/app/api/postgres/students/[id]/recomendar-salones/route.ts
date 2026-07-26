import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { recomendarSalones } from '@/services/recomendar-salones.service'

/**
 * GET /api/postgres/students/[id]/recomendar-salones   [id] = ACADEMICA._id
 *
 * Barrido de salones del MISMO curso en otras campañas: recomienda a qué campaña/salón
 * mover al alumno para que quede en su misma lección (ranking por cercanía de lección).
 * Gateado por STUDENT.ACADEMIA.CAMBIO_ACADEMICO (es una ayuda para el Cambio Académico).
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, StudentPermission.CAMBIO_ACADEMICO)
  const data = await recomendarSalones(params.id)
  return successResponse(data)
})
