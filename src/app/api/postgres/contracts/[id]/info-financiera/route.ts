import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ComercialPermission } from '@/types/permissions'
import { leerInfoFinanciera, actualizarInfoFinanciera } from '@/services/info-financiera.service'

/**
 * /api/postgres/contracts/[id]/info-financiera   (id = PEOPLE._id del titular)
 *
 * GET → lo guardado hoy, en la forma del formulario (precarga el modal).
 * PUT → guarda la información financiera en FINANCIEROS, el titular y la cuota
 *       #0, recalcula el saldo y regenera el contrato en Drive.
 * Gateado por COMERCIAL.CONTRATO.INFO_FINANCIERA.
 */
export const GET = handlerWithAuth(async (_req, { params }, session) => {
  await requirePermission(session, ComercialPermission.INFO_FINANCIERA)
  return successResponse(await leerInfoFinanciera(params.id))
})

export const PUT = handlerWithAuth(async (request, { params }, session) => {
  await requirePermission(session, ComercialPermission.INFO_FINANCIERA)
  const body = await request.json().catch(() => ({}))
  const user: any = (session as any)?.user || {}
  const r = await actualizarInfoFinanciera(params.id, body || {}, {
    email: user.email || 'desconocido',
    nombre: user.name || user.email || '',
  })
  return successResponse(r)
})
