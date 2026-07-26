import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { StudentPermission } from '@/types/permissions'
import { ValidationError } from '@/lib/errors'
import { previewMovimiento, ejecutarMovimiento } from '@/services/movimiento-academico.service'

/**
 * Movimiento Académico — cambia el Módulo/Lección del alumno dentro de su curso.
 * [id] = ACADEMICA._id. Gateado por STUDENT.ACADEMIA.MOVIMIENTO_ACADEMICO (SUPER_ADMIN/ADMIN bypass).
 *
 * GET  ?modulo=&leccion=  → vista previa del impacto (aprobar/perder, dirección, WELCOME).
 * POST { modulo, leccion, motivo? }  → ejecuta.
 */
export const GET = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, StudentPermission.MOVIMIENTO_ACADEMICO)
  const url = new URL(req.url)
  const modulo = url.searchParams.get('modulo') || ''
  const leccion = url.searchParams.get('leccion') || ''
  if (!modulo || !leccion) throw new ValidationError('modulo y leccion son requeridos')
  const preview = await previewMovimiento(params.id, modulo, leccion)
  return successResponse({ preview })
})

export const POST = handlerWithAuth(async (req, { params }, session) => {
  await requirePermission(session, StudentPermission.MOVIMIENTO_ACADEMICO)
  const body = await req.json()
  const { modulo, leccion, motivo } = body || {}
  if (!modulo || !leccion) throw new ValidationError('modulo y leccion son requeridos')
  const actor = { email: session.user?.email || null, nombre: (session.user as any)?.name || null }
  const result = await ejecutarMovimiento(params.id, modulo, leccion, actor, motivo)
  return successResponse({ message: 'Movimiento académico aplicado', ...result })
})
