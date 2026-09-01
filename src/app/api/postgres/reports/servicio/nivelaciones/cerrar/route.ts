import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query, queryOne, withTransaction } from '@/lib/postgres'
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/cerrar
 * Body: { academicaId, eventoId, resultado, comentario }
 *
 * Servicio cierra desde **Pendientes** una nivelación a la que el alumno no
 * asistió, sin esperar a que el guía entre a la sesión. Al cerrarse pasa al
 * Histórico, que es lo mismo que ya ocurre cuando la cierra el guía.
 *
 * Se distinguen dos motivos porque no son el mismo caso para quien hace
 * seguimiento: uno avisó y el otro nunca respondió.
 *
 * Tres decisiones del usuario que quedan fijadas aquí:
 *  - **el conteo NO baja** (a diferencia del cierre "No asistió" del guía): mide
 *    cuántas se le programaron, no cuántas aprovechó;
 *  - **el agendamiento se marca como no asistió**, para que la ficha del alumno y
 *    los informes de asistencia digan lo mismo que el histórico;
 *  - **el comentario es obligatorio**: un cierre administrativo sin explicación no
 *    le sirve a quien lo revise después.
 */
const RESULTADOS = ['NO_ASISTIO_JUSTIFICO', 'NO_ASISTIO_NO_CONTESTO'] as const
type Resultado = typeof RESULTADOS[number]

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)

  const body = await request.json().catch(() => ({}))
  const academicaId = String(body?.academicaId || '').trim()
  const eventoId = String(body?.eventoId || '').trim()
  const resultado = String(body?.resultado || '').trim() as Resultado
  const comentario = String(body?.comentario || '').trim()

  if (!academicaId) throw new ValidationError('Falta el usuario')
  if (!RESULTADOS.includes(resultado)) throw new ValidationError('Estado de cierre no válido')
  if (!comentario) throw new ValidationError('El comentario es obligatorio para cerrar la nivelación')

  const alumno = await queryOne<any>(
    `SELECT a."_id", a."nivelacion", a."aprobadoNivelacion", a."detalleNivelacion",
            COALESCE(a."NivelacionCount", 0)::int AS conteo,
            COALESCE(a."NivelacionHistory", '[]'::jsonb) AS historial,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."primerApellido"), '\\s+', ' ', 'g')) AS nombre
       FROM "ACADEMICA" a
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE a."_id" = $1`,
    [academicaId]
  )
  if (!alumno) throw new NotFoundError('ACADEMICA', academicaId)
  if (alumno.nivelacion !== true && alumno.aprobadoNivelacion !== true) {
    throw new ConflictError(`${alumno.nombre || 'El usuario'} no tiene una nivelación abierta.`)
  }

  const det = alumno.detalleNivelacion || {}
  const actor = (session.user as any)?.name || session.user?.email || 'Servicio'

  // Fecha del evento: se guarda en el histórico para poder leer la nivelación de
  // punta a punta (cuándo se pidió, para cuándo se agendó).
  const evento = eventoId
    ? await queryOne<{ dia: any }>(`SELECT "dia" FROM "CALENDARIO" WHERE "_id" = $1`, [eventoId])
    : null

  const entry = {
    fecha: new Date().toISOString(),
    fechaEvento: evento?.dia ? new Date(evento.dia).toISOString() : null,
    fechaSolicitud: det?.fecha || null,
    modulo: det?.modulo || null,
    leccion: det?.leccion || null,
    conteo: alumno.conteo,
    confirmadoEn: det?.confirmadoEn || null,
    confirmadoPor: det?.confirmadoPor || null,
    resultado,
    comentario,
    marcadoPor: actor,
    cerradoPorServicio: true,
  }

  await withTransaction(async (client) => {
    // El agendamiento queda como no asistió. Se toca sólo el de ESTE evento y no
    // se cancela: el alumno estuvo inscrito y esa historia se conserva.
    if (eventoId) {
      await client.query(
        `UPDATE "ACADEMICA_BOOKINGS"
            SET "asistio" = false, "asistencia" = false, "_updatedDate" = NOW()
          WHERE ("eventoId" = $2 OR "idEvento" = $2)
            AND ("idEstudiante" = $1 OR "studentId" = $1)
            AND "cancelo" IS NOT TRUE`,
        [academicaId, eventoId]
      )
    }
    // El conteo NO se toca a propósito (ver encabezado).
    await client.query(
      `UPDATE "ACADEMICA"
          SET "nivelacion" = false,
              "aprobadoNivelacion" = false,
              "detalleNivelacion" = NULL,
              "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $2::jsonb,
              "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [academicaId, JSON.stringify([entry])]
    )
  })

  return successResponse({ academicaId, nombre: alumno.nombre, resultado, conteo: alumno.conteo })
})
