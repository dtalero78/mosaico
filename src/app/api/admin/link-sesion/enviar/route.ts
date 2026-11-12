import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { enviarLink } from '@/services/link-contingencia.service'

/**
 * POST /api/admin/link-sesion/enviar
 * Body: { numeroId, telefono, confirmarReenvio? }
 *
 * Envía por WhatsApp el link de la próxima sesión de hoy del estudiante. La sesión
 * y el link se releen en el servidor; del cliente sólo vienen el ID y el teléfono.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.LINK_CONTINGENCIA)
  const b = await request.json().catch(() => ({}))
  const u = (session as any)?.user || {}
  const r = await enviarLink(
    { numeroId: String(b?.numeroId || ''), telefono: String(b?.telefono || ''), confirmarReenvio: b?.confirmarReenvio === true },
    { email: u.email || 'desconocido', nombre: u.name || u.email || 'desconocido' }
  )
  return successResponse({ ok: true, telefono: r.telefono })
})
