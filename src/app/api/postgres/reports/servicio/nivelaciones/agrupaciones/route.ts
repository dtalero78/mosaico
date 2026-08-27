import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/servicio/nivelaciones/agrupaciones?curso&leccion&guia
 *
 * Nivelaciones ya APROBADAS que todavía NO tienen evento: son las que Servicio
 * agrupa por (curso, lección) para crear UNA nivelación por grupo.
 *
 * "Ya tiene evento" NO se guarda en una columna: se DERIVA de que el alumno
 * tenga un agendamiento no cancelado en un evento `tipo='NIVELACION'` que aún
 * no ocurrió. Copiarlo a una bandera lo dejaría desfasado en cuanto el evento
 * se borre o el agendamiento se cancele. Si el evento ya pasó y nadie cerró la
 * nivelación, el alumno vuelve a aparecer aquí — que es lo correcto: esa
 * nivelación no se dictó y hay que reagendarla.
 *
 * Se devuelven además campaña / horario / salón porque son el alcance con el
 * que se creará el evento del grupo.
 */
const MAX_ROWS = 5000

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()

  // Ya agendada = agendamiento vivo en un evento NIVELACION que aún no ocurre.
  const YA_AGENDADA = `EXISTS (
     SELECT 1 FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
      WHERE (b."idEstudiante" = a."_id" OR b."studentId" = a."_id")
        AND UPPER(COALESCE(c."tipo", '')) = 'NIVELACION'
        AND b."cancelo" IS NOT TRUE
        AND c."dia" >= NOW()
   )`

  const where: string[] = [
    `a."aprobadoNivelacion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    `NOT ${YA_AGENDADA}`,
  ]
  const params: any[] = []
  let i = 1
  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (leccion) { where.push(`COALESCE(a."detalleNivelacion"->>'leccion','') = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }

  const rows = (await query(
    `SELECT a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId",
            p."salon",
            p."campaign",
            p."horarioCurso",
            (a."detalleNivelacion"->>'modulo') AS modulo,
            (a."detalleNivelacion"->>'leccion') AS leccion,
            n."description" AS tema,
            cc."guia" AS "guiaId",
            g."nombreCompleto" AS guia,
            g."zoom" AS "guiaZoom",
            COALESCE(a."NivelacionCount", 0)::int AS conteo,
            (a."detalleNivelacion"->>'fecha') AS fecha
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n ON n."curso" = p."tipoCurso" AND n."step" = (a."detalleNivelacion"->>'leccion')
      WHERE ${where.join(' AND ')}
      ORDER BY curso ASC NULLS LAST, leccion ASC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones de los dropdowns, sobre el mismo universo (aprobadas sin evento):
  // ofrecer una opción que devolvería cero filas sólo confunde.
  const opts = (await query(
    `SELECT DISTINCT p."tipoCurso" AS curso,
            (a."detalleNivelacion"->>'leccion') AS leccion,
            cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id"=cc."guia"
      WHERE a."aprobadoNivelacion" = true
        AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
        AND NOT ${YA_AGENDADA}`
  )).rows
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const cursos = uniq(opts.map((o: any) => o.curso)).sort()
  const lecciones = uniq(opts.map((o: any) => o.leccion)).sort()
  const guias = Array.from(
    new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values()
  )

  return successResponse({ rows, total: rows.length, cursos, lecciones, guias })
})
