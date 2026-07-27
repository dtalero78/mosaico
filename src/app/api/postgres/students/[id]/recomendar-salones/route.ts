import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { recomendarSalones } from '@/services/recomendar-salones.service'

/**
 * GET /api/postgres/students/[id]/recomendar-salones   [id] = ACADEMICA._id
 *   ?modulo=&leccion=   (opcional) lección de REFERENCIA
 *
 * Barrido de salones del MISMO curso en otras campañas: lista los salones y su cercanía
 * (gap) a una lección de referencia. Si se pasa modulo+leccion, el gap se mide contra esa
 * lección ELEGIDA (para "Ajuste Lecciones": ¿qué salones están en la lección destino?);
 * si no, contra la lección actual del alumno. Gateado por STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO.
 */
export const GET = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, StudentPermission.MOVIMIENTO_ACADEMICO)
  const { searchParams } = new URL(req.url)
  const modulo = searchParams.get('modulo')
  const leccion = searchParams.get('leccion')
  const target = leccion ? { modulo, leccion } : undefined
  const data = await recomendarSalones(params.id, target)
  return successResponse(data)
})
