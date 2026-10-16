import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany, queryOne } from '@/lib/postgres'

/**
 * GET /api/postgres/students/[id]/resumen-actividad   (id = ACADEMICA._id)
 *
 * Las tarjetas de la Tabla de Asistencia de /student:
 *   sesiones / nivelaciones / talleres asistidos  → agendamientos ya ocurridos,
 *       no cancelados, con asistencia (asistio o asistencia), por tipo del EVENTO
 *       (si el agendamiento es legacy sin evento, por el suyo; sin tipo, un step
 *       "CLUB - Step N" es taller y lo demás sesión). La bienvenida no cuenta.
 *   evaluaciones aprobadas / entrenamientos realizados → los cuestionarios de
 *       EVALUACION_RESPUESTAS, por categoría del módulo (`code` con "evaluac" o
 *       "entren", el mismo criterio del panel del alumno y del Seguimiento):
 *       aprobada = algún intento aprobado; realizado = al menos un intento.
 *       Cada cuestionario cuenta una vez aunque tenga varios intentos.
 *
 * Los agendamientos se buscan con todos los ids del alumno (su ACADEMICA y sus
 * fichas PEOPLE con el mismo documento), igual que la Tabla de Asistencia.
 */
export const GET = handlerWithAuth(async (_req, { params }) => {
  const academicaId = String(params?.id || '')

  const ids = (await queryMany<{ id: string }>(
    `SELECT a."_id" AS id FROM "ACADEMICA" a WHERE a."_id" = $1
     UNION
     SELECT p."_id" AS id FROM "PEOPLE" p
      WHERE p."numeroId" = (SELECT a."numeroId" FROM "ACADEMICA" a WHERE a."_id" = $1 LIMIT 1)`,
    [academicaId]
  )).map(r => r.id)
  if (!ids.length) ids.push(academicaId)

  const tipo = `UPPER(COALESCE(NULLIF(c."tipo",''), NULLIF(b."tipo",''), NULLIF(b."tipoEvento",''),
                  CASE WHEN b."step" ~ '^[A-Z]+ - Step' THEN 'CLUB' ELSE 'SESSION' END))`
  const esWelcome = `(UPPER(COALESCE(c."tituloONivel", b."tituloONivel", '')) LIKE '%WELCOME%'
                      OR UPPER(COALESCE(c."nivel", b."nivel", '')) = 'WELCOME')`

  const a = await queryOne<any>(
    `SELECT
       COUNT(*) FILTER (WHERE ${tipo} IN ('SESSION','RECUPERACION') AND NOT ${esWelcome})::int AS sesiones,
       COUNT(*) FILTER (WHERE ${tipo} = 'NIVELACION')::int AS nivelaciones,
       COUNT(*) FILTER (WHERE ${tipo} = 'CLUB')::int AS talleres
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      WHERE (b."idEstudiante" = ANY($1::text[]) OR b."studentId" = ANY($1::text[]))
        AND COALESCE(b."cancelo", false) = false
        AND (COALESCE(b."asistio", false) OR COALESCE(b."asistencia", false))
        AND COALESCE(c."dia", b."fechaEvento") <= NOW()`,
    [ids]
  )

  const q = await queryOne<any>(
    `WITH c AS (
       SELECT "code", "step", COALESCE("cuestionarioId", '') AS cid,
              BOOL_OR(COALESCE("aprobado", false)) AS aprobado
         FROM "EVALUACION_RESPUESTAS"
        WHERE "academicaId" = ANY($1::text[])
        GROUP BY 1, 2, 3
     )
     SELECT COUNT(*) FILTER (WHERE "code" ILIKE '%evaluac%' AND aprobado)::int AS "evaluacionesAprobadas",
            COUNT(*) FILTER (WHERE "code" ILIKE '%evaluac%')::int AS "evaluacionesPresentadas",
            COUNT(*) FILTER (WHERE "code" ILIKE '%entren%')::int AS "entrenamientosRealizados"
       FROM c`,
    [ids]
  ).catch(() => null) // si la tabla no existiera, las tarjetas de cuestionarios quedan en 0

  return successResponse({
    sesiones: a?.sesiones ?? 0,
    nivelaciones: a?.nivelaciones ?? 0,
    talleres: a?.talleres ?? 0,
    evaluacionesAprobadas: q?.evaluacionesAprobadas ?? 0,
    evaluacionesPresentadas: q?.evaluacionesPresentadas ?? 0,
    entrenamientosRealizados: q?.entrenamientosRealizados ?? 0,
  })
})
