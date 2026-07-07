import 'server-only'
import { handler, successResponse } from '@/lib/api-helpers'
import { queryOne } from '@/lib/postgres'

const ADVISOR_JOIN = `LEFT JOIN "GUIAS" adv ON adv."_id" = b."advisor"`
const EVENTO_JOIN  = `LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")`

const SELECT_FIELDS = `
  b."_id",
  b."fechaEvento",
  b."hora",
  COALESCE(adv."nombreCompleto", b."advisor") AS "advisorNombre",
  COALESCE(c."nivel", b."nivel")              AS "nivel",
  COALESCE(c."step", b."step")               AS "step",
  b."asistio", b."asistencia", b."participacion", b."noAprobo",
  b."tipo", b."tipoEvento"
`

const WHERE_STUDENT = `(b."idEstudiante" = $1 OR b."studentId" = $1)`

/**
 * GET /api/postgres/students/[id]/ultimos-agendamientos
 * Returns last attended session, last approved jump, last attended club.
 */
export const GET = handler(async (
  _req: Request,
  { params }: { params: Record<string, string> }
) => {
  const academicaId = params.id

  const [ultimaSesion, ultimoJump, ultimoClub] = await Promise.all([
    // Última sesión asistida (tipo SESSION, excluyendo WELCOME)
    queryOne(
      `SELECT ${SELECT_FIELDS}
       FROM "ACADEMICA_BOOKINGS" b
       ${EVENTO_JOIN}
       ${ADVISOR_JOIN}
       WHERE ${WHERE_STUDENT}
         AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'SESSION'
         AND COALESCE(c."nivel", b."nivel") IS DISTINCT FROM 'WELCOME'
         AND (b."asistio" = true OR b."asistencia" = true)
         AND (b."cancelo" IS NULL OR b."cancelo" = false)
       ORDER BY b."fechaEvento" DESC NULLS LAST
       LIMIT 1`,
      [academicaId]
    ),

    // Último jump aprobado (step múltiplo de 5, asistió, no reprobó)
    queryOne(
      `SELECT ${SELECT_FIELDS}
       FROM "ACADEMICA_BOOKINGS" b
       ${EVENTO_JOIN}
       ${ADVISOR_JOIN}
       WHERE ${WHERE_STUDENT}
         AND (b."asistio" = true OR b."asistencia" = true)
         AND (b."noAprobo" IS NULL OR b."noAprobo" = false)
         AND (b."cancelo" IS NULL OR b."cancelo" = false)
         AND CAST(
               NULLIF(REGEXP_REPLACE(COALESCE(c."step", b."step", ''), '[^0-9]', '', 'g'), '')
               AS INTEGER
             ) % 5 = 0
         AND CAST(
               NULLIF(REGEXP_REPLACE(COALESCE(c."step", b."step", ''), '[^0-9]', '', 'g'), '')
               AS INTEGER
             ) > 0
       ORDER BY b."fechaEvento" DESC NULLS LAST
       LIMIT 1`,
      [academicaId]
    ),

    // Último club asistido (tipo CLUB)
    queryOne(
      `SELECT ${SELECT_FIELDS}
       FROM "ACADEMICA_BOOKINGS" b
       ${EVENTO_JOIN}
       ${ADVISOR_JOIN}
       WHERE ${WHERE_STUDENT}
         AND COALESCE(c."tipo", b."tipo", b."tipoEvento") = 'CLUB'
         AND (b."asistio" = true OR b."asistencia" = true)
         AND (b."cancelo" IS NULL OR b."cancelo" = false)
       ORDER BY b."fechaEvento" DESC NULLS LAST
       LIMIT 1`,
      [academicaId]
    ),
  ])

  return successResponse({ ultimaSesion, ultimoJump, ultimoClub })
})
