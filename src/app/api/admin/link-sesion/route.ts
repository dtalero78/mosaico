import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { buscarSesionHoy } from '@/services/link-contingencia.service'

/**
 * GET /api/admin/link-sesion?numeroId=
 * Próxima sesión de hoy del estudiante (campaña, curso, salón, guía y link).
 * Gateado por MANTENIMIENTO.USUARIOS.ENVIO_LINK_CONTINGENCIA.
 */
export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.LINK_CONTINGENCIA)
  const numeroId = new URL(request.url).searchParams.get('numeroId') || ''
  const resultado = await buscarSesionHoy(numeroId)
  return successResponse({ resultado })
})
