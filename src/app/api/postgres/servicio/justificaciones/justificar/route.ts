import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ServicioPermission } from '@/types/permissions'
import { justificarInasistencia } from '@/services/gestion-justificacion.service'

/**
 * POST /api/postgres/servicio/justificaciones/justificar
 * Body: { bookingId, justificar: boolean, motivo? }
 *
 * Justifica (motivo obligatorio) o quita la justificación de una inasistencia.
 * El actor sale de la sesión. El rol GUIA sólo puede tocar las de sus cursos.
 * Gateado por SERVICIO.JUSTIFICACION.JUSTIFICAR.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.JUSTIFICACION_JUSTIFICAR)
  const b = await request.json().catch(() => ({}))
  const r = await justificarInasistencia(session, {
    bookingId: b?.bookingId,
    justificar: !!b?.justificar,
    motivo: b?.motivo,
  })
  return successResponse(r)
})
