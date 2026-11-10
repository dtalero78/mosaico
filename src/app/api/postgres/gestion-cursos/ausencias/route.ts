import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { ValidationError } from '@/lib/errors'
import { listarAusencias, opcionesCursos } from '@/services/gestion-cursos.service'

/**
 * GET /api/postgres/gestion-cursos/ausencias?startDate&endDate&campaign&curso&salon&guia&usuario[&soloOpciones=1]
 * Alumnos con 2 o más ausencias SIN justificar en el período (un sábado de dos
 * lecciones cuenta dos). `soloOpciones=1` devuelve únicamente los menús de filtro.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.GESTION_CURSOS_AUSENCIAS)
  const sp = new URL(request.url).searchParams
  if (sp.get('soloOpciones')) return successResponse({ opciones: await opcionesCursos() })
  const startDate = (sp.get('startDate') || '').trim()
  const endDate = (sp.get('endDate') || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new ValidationError('startDate y endDate son requeridos (YYYY-MM-DD)')
  }
  const { rows, opciones } = await listarAusencias({
    startDate, endDate,
    campaign: sp.get('campaign') || undefined, curso: sp.get('curso') || undefined,
    salon: sp.get('salon') || undefined, guia: sp.get('guia') || undefined,
    usuario: (sp.get('usuario') || '').trim() || undefined,
  })
  return successResponse({ rows, total: rows.length, opciones })
})
