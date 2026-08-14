import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { cupoOcupadoSql } from '@/lib/cupo'
import { ServicioPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/servicio/casos-atencion?curso&salon&leccion&guia&startDate&endDate
 *
 * Bookings con un Caso de Atención ABIERTO (ACADEMICA_BOOKINGS.casoAtencion=true):
 * el guía escribió un caso en /sesion/[id]. Una fila por (estudiante, evento).
 * Columnas: curso, nombre, salón, lección (+ tema), guía, fecha del evento, el
 * caso (advisorAnotaciones) y conteo de casos abiertos del estudiante. Gateado
 * por SERVICIO.CASOS_ATENCION.VER.
 */
const MAX_ROWS = 5000

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const where: string[] = [
    `b."casoAtencion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    // Sólo los que ocupan cupo (ver lib/cupo): un contrato retractado ya no es
    // alumno del salón, así que su caso no debe seguir en la bandeja.
    cupoOcupadoSql('p'),
  ]
  const params: any[] = []
  let i = 1
  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)   { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`COALESCE(c."step", b."step") = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }
  if (startDate) { where.push(`COALESCE(c."dia", b."fechaEvento") >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`COALESCE(c."dia", b."fechaEvento") < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }

  const rows = (await query(
    `SELECT b."_id" AS "bookingId",
            a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId" AS "numeroId",
            p."salon",
            COALESCE(c."step", b."step") AS leccion,
            n."description" AS tema,
            g."nombreCompleto" AS guia,
            b."advisorAnotaciones" AS caso,
            COALESCE(c."dia", b."fechaEvento") AS fecha,
            COUNT(*) OVER (PARTITION BY a."_id")::int AS conteo
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n ON n."curso" = p."tipoCurso" AND n."step" = COALESCE(c."step", b."step")
      WHERE ${where.join(' AND ')}
      ORDER BY fecha DESC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones de dropdowns (sobre los casos abiertos)
  const opts = (await query(
    `SELECT DISTINCT p."tipoCurso" AS curso, p."salon" AS salon,
            COALESCE(c."step", b."step") AS leccion,
            cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id"=cc."guia"
      WHERE b."casoAtencion" = true AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
        AND ${cupoOcupadoSql('p')}`
  )).rows
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const cursos = uniq(opts.map((o: any) => o.curso)).sort()
  const salones = uniq(opts.map((o: any) => o.salon)).sort()
  const lecciones = uniq(opts.map((o: any) => o.leccion)).sort()
  const guias = Array.from(new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values())

  return successResponse({ rows, total: rows.length, cursos, salones, lecciones, guias })
})
