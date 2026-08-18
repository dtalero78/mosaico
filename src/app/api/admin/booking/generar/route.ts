import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { MantenimientoPermission } from '@/types/permissions'
import { queryOne } from '@/lib/postgres'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { generarBookingsBeneficiario } from '@/services/cursos-campaign-eventos.service'

/**
 * POST /api/admin/booking/generar   Body: { peopleId }
 *
 * Genera los agendamientos que le falten al beneficiario sobre los eventos de su
 * curso. Reusa `generarBookingsBeneficiario` — el mismo generador de la aprobación
 * del contrato —, que es idempotente (no duplica los que ya tiene).
 *
 * **Sólo sesiones FUTURAS**: crear las pasadas dejaría al alumno marcado AUSENTE en
 * clases donde nunca estuvo inscrito. Para el histórico está la reconciliación que
 * preserva estado (`regenerarCursoPreservandoEstado`).
 *
 * Gateado por MANTENIMIENTO.USUARIOS.BOOKING.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.BOOKING)

  const body = await request.json().catch(() => ({}))
  const peopleId = String(body?.peopleId || '').trim()
  if (!peopleId) throw new ValidationError('Falta el usuario')

  const p = await queryOne<any>(
    `SELECT p."_id", p."numeroId", p."primerNombre", p."primerApellido", p."celular",
            p."plataforma", p."campaign", p."tipoCurso", p."horarioCurso", p."salon",
            p."tipoUsuario", a."_id" AS "academicaId"
       FROM "PEOPLE" p
       LEFT JOIN "ACADEMICA" a ON a."peopleId" = p."_id"
      WHERE p."_id" = $1`,
    [peopleId]
  )
  if (!p) throw new NotFoundError('Usuario', peopleId)
  if (p.tipoUsuario !== 'BENEFICIARIO') {
    throw new ValidationError('Sólo los beneficiarios tienen agendamientos; este documento es de un titular')
  }
  if (!p.academicaId) {
    throw new ValidationError('El usuario no tiene registro académico (ACADEMICA)')
  }
  if (!p.campaign || !p.tipoCurso || !p.horarioCurso) {
    throw new ValidationError('El usuario no tiene curso asignado (campaña / curso / horario)')
  }

  const actor = (session?.user as any)?.email || 'admin'
  const creados = await generarBookingsBeneficiario(p.academicaId, p, {
    soloFuturos: true,
    agendadoPor: `Booking manual (${actor})`,
  })

  // Cómo queda
  const resumen = await queryOne<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e."dia" >= NOW())::int AS futuros,
            MIN(e."dia") FILTER (WHERE e."dia" >= NOW())::text AS proxima
       FROM "ACADEMICA_BOOKINGS" k
       JOIN "CALENDARIO" e ON e."_id" = k."eventoId" OR e."_id" = k."idEvento"
      WHERE k."idEstudiante" = $1 OR k."studentId" = $1`,
    [p.academicaId]
  )

  return successResponse({
    creados,
    total: resumen?.total ?? 0,
    futuros: resumen?.futuros ?? 0,
    proxima: resumen?.proxima || null,
  })
})
