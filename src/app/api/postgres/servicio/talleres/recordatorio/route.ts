import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ServicioPermission } from '@/types/permissions'
import { enviarRecordatorios } from '@/services/talleres.service'

/**
 * POST /api/postgres/servicio/talleres/recordatorio
 * Body: { bookingIds: string[] }
 *
 * Envía la plantilla "Recordatorio Taller" a los inscritos elegidos. El destino
 * y el texto los resuelve el servidor; sólo para talleres que aún no terminan.
 * Gateado por SERVICIO.TALLERES.ENVIAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.TALLERES_ENVIAR as any)
  const body = await request.json().catch(() => ({}))
  const bookingIds: string[] = Array.isArray(body?.bookingIds) ? body.bookingIds : []
  const user: any = session.user || {}
  const res = await enviarRecordatorios(bookingIds, {
    email: String(user.email || ''),
    nombre: String(user.name || user.email || 'Servicio'),
  })
  return successResponse(res)
})
