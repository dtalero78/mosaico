import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { queryOne, withTransaction } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { ValidationError, NotFoundError } from '@/lib/errors'

/**
 * POST /api/postgres/students/[id]/caso-atencion   (id = ACADEMICA._id)
 * Body: { bookingId, comentario }
 *
 * Marca RESUELTO un Caso de Atención: cierra el caso del booking
 * (ACADEMICA_BOOKINGS.casoAtencion=false) y agrega un comentario al historial
 * del estudiante (ACADEMICA.historicCasoAtencion — mismo tipo que
 * cambioAcademicoHistory). Atómico. Gateado por SERVICIO.CASOS_ATENCION.GESTION.
 */
export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION)

  const academicaId = decodeURIComponent(ctx.params.id || '').trim()
  const body = await req.json().catch(() => ({}))
  const bookingId = String(body?.bookingId || '').trim()
  const comentario = String(body?.comentario || '').trim()
  if (!academicaId) throw new ValidationError('academicaId requerido')
  if (!bookingId) throw new ValidationError('bookingId requerido')
  if (!comentario) throw new ValidationError('El comentario es obligatorio')

  // Datos del caso para el historial (curso, lección, fecha del evento, texto).
  const info = await queryOne<any>(
    `SELECT b."advisorAnotaciones" AS caso,
            COALESCE(c."step", b."step") AS leccion,
            p."tipoCurso" AS curso,
            COALESCE(c."dia", b."fechaEvento") AS "fechaEvento"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE b."_id" = $1`,
    [bookingId]
  )
  if (!info) throw new NotFoundError('Booking', bookingId)

  const entry = {
    fecha: new Date().toISOString(),
    comentario,
    curso: info.curso || null,
    leccion: info.leccion || null,
    caso: info.caso || null,
    fechaEvento: info.fechaEvento ? new Date(info.fechaEvento).toISOString() : null,
    resueltoPor: session?.user?.email || null,
    resueltoPorNombre: (session?.user as any)?.name || null,
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE "ACADEMICA_BOOKINGS" SET "casoAtencion" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [bookingId]
    )
    await client.query(
      `UPDATE "ACADEMICA"
          SET "historicCasoAtencion" = COALESCE("historicCasoAtencion", '[]'::jsonb) || $2::jsonb,
              "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [academicaId, JSON.stringify([entry])]
    )
  })

  return successResponse({ ok: true })
})
