import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany, queryOne } from '@/lib/postgres'
import { ValidationError, NotFoundError } from '@/lib/errors'

export const GET = handlerWithAuth(async (req, _ctx, _session) => {
  const { searchParams } = new URL(req.url)
  const eventId = searchParams.get('eventId')?.trim()

  if (!eventId) throw new ValidationError('eventId es requerido')

  // Event header from CALENDARIO
  const event = await queryOne<{
    _id: string; dia: string; hora: string | null; nivel: string | null
    step: string | null; nombreEvento: string | null; tituloONivel: string | null
    advisor: string | null; limiteUsuarios: number
  }>(
    `SELECT c."_id", c."dia", c."hora", c."nivel", c."step",
            COALESCE(c."nombreEvento", c."tituloONivel", '') AS "nombreEvento",
            c."tituloONivel",
            COALESCE(adv."nombreCompleto", c."advisor", 'Sin advisor') AS "advisor",
            COALESCE(c."limiteUsuarios", 0)::int AS "limiteUsuarios"
     FROM "CALENDARIO" c
     LEFT JOIN "GUIAS" adv
       ON adv."_id" = c."advisor" OR LOWER(adv."email") = LOWER(c."advisor")
     WHERE c."_id" = $1`,
    [eventId]
  )
  if (!event) throw new NotFoundError('Evento', eventId)

  // Bookings with student info (non-cancelled)
  const bookings = await queryMany<{
    _id: string
    primerNombre: string; primerApellido: string
    email: string | null; numeroId: string | null
    asistio: boolean; asistencia: boolean; cancelo: boolean
  }>(
    `SELECT
       b."_id",
       COALESCE(ac."primerNombre", p."primerNombre", '') AS "primerNombre",
       COALESCE(ac."primerApellido", p."primerApellido", '') AS "primerApellido",
       COALESCE(ac."email", p."email", '') AS "email",
       COALESCE(ac."numeroId", p."numeroId", '') AS "numeroId",
       COALESCE(b."asistio",    false) AS "asistio",
       COALESCE(b."asistencia", false) AS "asistencia",
       COALESCE(b."cancelo",    false) AS "cancelo"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "ACADEMICA" ac
       ON ac."_id" = COALESCE(b."studentId", b."idEstudiante")
     LEFT JOIN "PEOPLE" p
       ON p."_id" = COALESCE(b."studentId", b."idEstudiante")
     WHERE COALESCE(b."eventoId", b."idEvento") = $1
       AND (b."cancelo" IS NULL OR b."cancelo" = false)
       AND NOT EXISTS (
         SELECT 1 FROM "PEOPLE" pp_prb
         WHERE pp_prb."numeroId" = b."numeroId"
           AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
       )
     ORDER BY "primerApellido", "primerNombre"`,
    [eventId]
  )

  const asistieron    = bookings.filter(u => u.asistio || u.asistencia).length
  const noAsistieron  = bookings.length - asistieron

  const session = {
    id:              event._id,
    nombre:          event.nombreEvento || event.tituloONivel || '',
    fecha:           event.dia.toString().substring(0, 10),
    hora:            event.hora ?? '',
    nivel:           event.nivel ?? '',
    step:            event.step ?? '',
    advisor:         event.advisor ?? '',
    capacidad:       event.limiteUsuarios,
    usuariosAgendados: bookings.length,
    asistieron,
    noAsistieron,
  }

  const users = bookings.map(u => ({
    _id:              u._id,
    nombre:           `${u.primerNombre} ${u.primerApellido}`.trim() || 'Sin nombre',
    email:            u.email || null,
    numeroId:         u.numeroId || null,
    estadoAsistencia: (u.asistio || u.asistencia) ? 'Asistió' : 'No asistió',
  }))

  return successResponse({ session, users })
})
