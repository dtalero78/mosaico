import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ValidationError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import {
  buscarAlumnoTalleres, sacarDeEvento, trasladarAEvento, destinosDisponibles,
} from '@/services/reasignacion-agenda.service'

/**
 * Talleres › Gestión usuario. Gate: SERVICIO.TALLERES.GESTION_USUARIO.
 *
 *   POST { accion:'buscar', documento }                      → alumno + sus talleres próximos
 *   POST { accion:'destinos', bookingId }                    → talleres a los que se puede trasladar
 *   POST { accion:'sacar', bookingId, motivo }               → cancela su agendamiento al taller
 *   POST { accion:'trasladar', bookingId, destinoEventoId, motivo, cancelarCruces? }
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.TALLERES_GESTION_USUARIO as any)
  const body = await request.json().catch(() => ({}))
  const bookingIds = body?.bookingId ? [String(body.bookingId)] : []
  const actor = {
    email: session?.user?.email || '',
    nombre: session?.user?.name || session?.user?.email || '',
    rol: (session?.user as any)?.role || undefined,
  }
  switch (body?.accion) {
    case 'buscar':
      return successResponse(await buscarAlumnoTalleres(String(body?.documento || '')))
    case 'destinos':
      return successResponse({ destinos: await destinosDisponibles({ bookingIds, tipo: 'CLUB' }) })
    case 'sacar':
      return successResponse(await sacarDeEvento({ bookingIds, tipo: 'CLUB', motivo: body?.motivo, actor }))
    case 'trasladar':
      return successResponse(await trasladarAEvento({
        bookingIds, tipo: 'CLUB', destinoEventoId: String(body?.destinoEventoId || ''),
        motivo: body?.motivo, actor, cancelarCruces: body?.cancelarCruces === true,
      }))
    default:
      throw new ValidationError('Acción no válida')
  }
})
