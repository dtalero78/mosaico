import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requireAnyPermission } from '@/lib/api-permissions'
import { AcademicoPermission } from '@/types/permissions'
import { listarCursos, opcionesCursos } from '@/services/gestion-cursos.service'

/**
 * GET /api/postgres/gestion-cursos/cursos?campaign&curso&salon&guia[&soloOpciones=1]
 * Una fila por curso vigente con inicial / con cupo / efectivos / retirados /
 * cancelados. Lo usan Seguimiento Cursos y Curso Guía (cada una filtra y agrupa
 * en la pantalla). `soloOpciones=1` devuelve únicamente los menús de filtro.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requireAnyPermission(session, [
    AcademicoPermission.GESTION_CURSOS_SEGUIMIENTO,
    AcademicoPermission.GESTION_CURSOS_CURSO_GUIA,
  ])
  const sp = new URL(request.url).searchParams
  if (sp.get('soloOpciones')) return successResponse({ opciones: await opcionesCursos() })
  const { filas, opciones } = await listarCursos({
    campaign: sp.get('campaign') || undefined, curso: sp.get('curso') || undefined,
    salon: sp.get('salon') || undefined, guia: sp.get('guia') || undefined,
  })
  return successResponse({ filas, total: filas.length, opciones })
})
