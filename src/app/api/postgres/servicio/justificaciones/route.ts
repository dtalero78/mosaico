import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ServicioPermission } from '@/types/permissions'
import { listarInasistencias } from '@/services/gestion-justificacion.service'

/**
 * GET /api/postgres/servicio/justificaciones
 *   ?usuario&campaign&curso&salon&guiaId&startDate&endDate&estado=pendientes|justificadas
 *
 * Inasistencias (por defecto del último mes) con su estado de justificación.
 * Con el rol GUIA el `guiaId` pedido se ignora y se usa el del guía logueado.
 * Gateado por SERVICIO.JUSTIFICACION.VER.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.JUSTIFICACION_VER)
  const sp = new URL(request.url).searchParams
  const g = (k: string) => (sp.get(k) || '').trim()
  const estado = g('estado')
  const data = await listarInasistencias(session, {
    usuario: g('usuario'),
    campaign: g('campaign'),
    curso: g('curso'),
    salon: g('salon'),
    guiaId: g('guiaId'),
    startDate: g('startDate'),
    endDate: g('endDate'),
    estado: estado === 'pendientes' || estado === 'justificadas' ? estado : '',
  })
  return successResponse(data)
})
