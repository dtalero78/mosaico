import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ServicioPermission } from '@/types/permissions'
import { listarTalleres, type ModoTalleres } from '@/services/talleres.service'

/**
 * GET /api/postgres/servicio/talleres?modo=proximos|historico&usuario&campaign&curso&salon&desde&hasta
 *
 * Talleres con sus inscritos (ver `talleres.service`). Gateado por
 * SERVICIO.TALLERES.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.TALLERES_VER as any)
  const sp = new URL(request.url).searchParams
  const modo: ModoTalleres = sp.get('modo') === 'historico' ? 'historico' : 'proximos'
  const data = await listarTalleres({
    modo,
    usuario: sp.get('usuario') || '',
    campaign: sp.get('campaign') || '',
    curso: sp.get('curso') || '',
    salon: sp.get('salon') || '',
    desde: sp.get('desde') || '',
    hasta: sp.get('hasta') || '',
  })
  return successResponse({ modo, ...data })
})
