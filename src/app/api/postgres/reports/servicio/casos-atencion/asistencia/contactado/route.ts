import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ValidationError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import { generateId } from '@/lib/id-generator'

/**
 * POST /api/postgres/reports/servicio/casos-atencion/asistencia/contactado
 * Body: { bookingId, academicaId?, numeroId?, contactado: boolean }
 *
 * Marca (o desmarca) "Contactado apoderado" para una inasistencia concreta.
 * Guarda quién lo marcó y cuándo. El actor sale de la sesión, no del body.
 * Gateado por SERVICIO.CASOS_ATENCION.GESTION.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION)

  const b = await request.json().catch(() => ({}))
  const bookingId = String(b?.bookingId || '').trim()
  if (!bookingId) throw new ValidationError('Falta el registro de inasistencia.')
  const contactado = !!b?.contactado
  const email = (session as any)?.user?.email || 'desconocido'

  await query(
    `INSERT INTO "INASISTENCIA_GESTION"
       ("_id","bookingId","academicaId","numeroId","contactadoApoderado","contactadoPor","contactadoEn")
     VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5 THEN NOW() ELSE NULL END)
     ON CONFLICT ("bookingId") DO UPDATE SET
       "contactadoApoderado" = EXCLUDED."contactadoApoderado",
       "contactadoPor"       = CASE WHEN EXCLUDED."contactadoApoderado" THEN EXCLUDED."contactadoPor" ELSE NULL END,
       "contactadoEn"        = CASE WHEN EXCLUDED."contactadoApoderado" THEN NOW() ELSE NULL END,
       "_updatedDate"        = NOW()`,
    [generateId('ing'), bookingId, b?.academicaId || null, b?.numeroId || null, contactado, email]
  )

  return successResponse({ ok: true, contactado })
})
