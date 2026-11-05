import 'server-only'
import { NextRequest } from 'next/server'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requireAnyPermission, tienePermiso } from '@/lib/api-permissions'
import { PersonPermission } from '@/types/permissions'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { leerRecibo } from '@/services/recibo-inscripcion.service'

/**
 * POST /api/postgres/pagos-titulares/leer-comprobante   Body: { url }
 *
 * Lee con IA el comprobante de un pago (Webpay, transferencia...) para precargar
 * el formulario "Registrar Pago": fecha, monto, medio y referencia. NO guarda
 * nada. Sólo lee archivos de NUESTRO bucket. Gate: registrar o validar pagos y
 * además LEER_RECIBO (SUPER_ADMIN/ADMIN pasan).
 */
export const POST = handlerWithAuth(async (req: NextRequest, _ctx, session) => {
  await requireAnyPermission(session, [PersonPermission.PAGOS_REGISTRAR, PersonPermission.PAGOS_VALIDAR] as any)
  if (!(await tienePermiso(session, PersonPermission.LEER_RECIBO as any))) {
    throw new ForbiddenError('La lectura de comprobantes no está habilitada para tu rol.')
  }
  const body = await req.json().catch(() => ({}))
  const url = String(body?.url || '').trim()
  if (!url) throw new ValidationError('url del comprobante es requerida.')
  const extraido = await leerRecibo(url)
  return successResponse({ extraido })
})
