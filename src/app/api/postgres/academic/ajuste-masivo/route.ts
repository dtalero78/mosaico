import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { ValidationError } from '@/lib/errors'
import { listarCursos, previewAjusteMasivo, aplicarAjusteMasivo } from '@/services/ajuste-masivo.service'

/**
 * Ajuste masivo (Académico › Mantenimiento). Gateado por
 * ACADEMICO.AJUSTE_MASIVO.APLICAR (SUPER_ADMIN/ADMIN bypass).
 *
 * GET                                  → cursos activos (cascada Campaña → Curso → Salón)
 * GET ?cursoId=                        → alumnos del salón con su posición actual
 * GET ?cursoId=&modulo=&leccion=       → + vista previa por alumno (qué se le hará)
 * POST { cursoId, modulo, leccion, motivo, academicaIds }  → aplica (+ permitirRetroceso: true para retroceder)
 */
export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.AJUSTE_MASIVO)
  const url = new URL(req.url)
  const cursoId = (url.searchParams.get('cursoId') || '').trim()
  if (!cursoId) return successResponse({ cursos: await listarCursos() })
  const modulo = (url.searchParams.get('modulo') || '').trim()
  const leccion = (url.searchParams.get('leccion') || '').trim()
  return successResponse(await previewAjusteMasivo(cursoId, modulo || undefined, leccion || undefined, url.searchParams.get('retroceder') === '1'))
})

export const POST = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.AJUSTE_MASIVO)
  const body = await req.json().catch(() => ({}))
  const { cursoId, modulo, leccion, motivo, academicaIds, permitirRetroceso } = body || {}
  if (!cursoId) throw new ValidationError('cursoId es requerido')
  if (!Array.isArray(academicaIds)) throw new ValidationError('academicaIds debe ser una lista')
  const actor = { email: session.user?.email || null, nombre: (session.user as any)?.name || null }
  const r = await aplicarAjusteMasivo(String(cursoId), String(modulo || ''), String(leccion || ''), String(motivo || ''), academicaIds, actor, permitirRetroceso === true)
  return successResponse({ message: `Ajuste aplicado a ${r.ok} alumno(s)`, ...r })
})
