import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/servicio/nivelaciones?curso&salon&leccion&guia&startDate&endDate
 *
 * Estudiantes con ACADEMICA.nivelacion = true y aún NO aprobados (pendientes).
 * Columnas: curso, nombre, salón, lección (+ tema/descripción), guía, conteo
 * (NivelacionCount = 1ª/2ª nivelación). El guía se resuelve por CURSOS_CAMPAIGN
 * (campaña+curso+horario) → GUIAS. Rango de fecha sobre la fecha de marcado
 * (detalleNivelacion->>'fecha'). Gateado por SERVICIO.NIVELACIONES.VER.
 */
const MAX_ROWS = 5000

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const where: string[] = [
    `a."nivelacion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
  ]
  const params: any[] = []
  let i = 1
  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)   { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`(a."detalleNivelacion"->>'leccion') = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }
  if (startDate) { where.push(`(a."detalleNivelacion"->>'fecha')::timestamptz >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`(a."detalleNivelacion"->>'fecha')::timestamptz < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }

  const rows = (await query(
    `SELECT a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."salon",
            (a."detalleNivelacion"->>'leccion') AS leccion,
            n."description" AS tema,
            g."nombreCompleto" AS guia,
            COALESCE(a."NivelacionCount", 0)::int AS conteo,
            (a."detalleNivelacion"->>'fecha') AS fecha
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n ON n."curso" = p."tipoCurso" AND n."step" = (a."detalleNivelacion"->>'leccion')
      WHERE ${where.join(' AND ')}
      ORDER BY fecha DESC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones de dropdowns (sobre las nivelaciones pendientes)
  const opts = (await query(
    `SELECT DISTINCT p."tipoCurso" AS curso, p."salon" AS salon,
            (a."detalleNivelacion"->>'leccion') AS leccion,
            cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."campaign"=p."campaign" AND cc."tipoCurso"=p."tipoCurso" AND cc."horarioCurso"=p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id"=cc."guia"
      WHERE a."nivelacion" = true AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`
  )).rows
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const cursos = uniq(opts.map((o: any) => o.curso)).sort()
  const salones = uniq(opts.map((o: any) => o.salon)).sort()
  const lecciones = uniq(opts.map((o: any) => o.leccion)).sort()
  const guias = Array.from(new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values())

  return successResponse({ rows, total: rows.length, cursos, salones, lecciones, guias })
})
