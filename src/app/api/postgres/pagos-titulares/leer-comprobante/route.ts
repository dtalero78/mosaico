import 'server-only'
import { NextRequest } from 'next/server'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requireAnyPermission, tienePermiso } from '@/lib/api-permissions'
import { PersonPermission } from '@/types/permissions'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { leerRecibo } from '@/services/recibo-inscripcion.service'
import { queryMany } from '@/lib/postgres'

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
  // Posibles duplicados: misma referencia, o mismo monto y misma fecha, ya registrados en cualquier titular.
  const ref = String(extraido.referencia || '').trim()
  const duplicados = (ref || (extraido.monto && extraido.fecha))
    ? await queryMany<any>(
        'SELECT pt."_id", pt."numeroReferencia", pt."valorPagado", pt."fechaPago"::text AS "fechaPago", pt."validado", p."contrato", ' +
        'CONCAT_WS(\' \', p."primerNombre", p."primerApellido") AS titular ' +
        'FROM "PAGOS_TITULARES" pt JOIN "PEOPLE" p ON p."_id" = pt."idPeople" ' +
        'WHERE (length($1) >= 4 AND lower(trim(pt."numeroReferencia")) = lower($1)) ' +
        'OR ($2::numeric > 0 AND $3::date IS NOT NULL AND pt."valorPagado" = $2::numeric AND pt."fechaPago" = $3::date) ' +
        'ORDER BY pt."_createdDate" DESC LIMIT 3',
        [ref, extraido.monto ?? 0, extraido.fecha || null],
      )
    : []
  return successResponse({ extraido, duplicados })
})
