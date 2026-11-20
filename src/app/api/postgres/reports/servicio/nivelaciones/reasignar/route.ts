import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ValidationError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import { sacarDeEvento, trasladarAEvento, destinosDisponibles } from '@/services/reasignacion-agenda.service'

/**
 * Nivelaciones › Pendientes: sacar a los alumnos marcados de su nivelación o
 * trasladarlos a otra. Gate: SERVICIO.NIVELACIONES.GESTION.
 *
 *   POST { accion:'destinos', bookingIds }                              → opciones de destino
 *   POST { accion:'sacar', bookingIds, motivo }                         → cancela el agendamiento
 *   POST { accion:'trasladar', bookingIds, destinoEventoId, motivo, cancelarCruces? }
 *
 * Todo o nada: si un alumno no se puede mover, no se mueve ninguno.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)
  const body = await request.json().catch(() => ({}))
  const bookingIds: string[] = Array.isArray(body?.bookingIds) ? body.bookingIds.map(String) : []
  const actor = {
    email: session?.user?.email || '',
    nombre: session?.user?.name || session?.user?.email || '',
    rol: (session?.user as any)?.role || undefined,
  }
  switch (body?.accion) {
    case 'destinos':
      return successResponse({ destinos: await destinosDisponibles({ bookingIds, tipo: 'NIVELACION' }) })
    case 'sacar':
      return successResponse(await sacarDeEvento({ bookingIds, tipo: 'NIVELACION', motivo: body?.motivo, actor }))
    case 'trasladar':
      return successResponse(await trasladarAEvento({
        bookingIds, tipo: 'NIVELACION', destinoEventoId: String(body?.destinoEventoId || ''),
        motivo: body?.motivo, actor, cancelarCruces: body?.cancelarCruces === true,
      }))
    default:
      throw new ValidationError('Acción no válida')
  }
})
