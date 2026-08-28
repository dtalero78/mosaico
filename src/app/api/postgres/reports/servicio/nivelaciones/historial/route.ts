import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/servicio/nivelaciones/historial?guia&curso&startDate&endDate
 *
 * Las nivelaciones que YA SE DICTARON, de la más reciente a la más antigua,
 * para agruparlas por curso en la pantalla.
 *
 * Sólo entran las CERRADAS: cada entrada de `NivelacionHistory`, que se escribe
 * cuando el guía marca la asistencia del evento (REALIZADA o NO_ASISTIO). Las
 * que están esperando aprobación viven en Solicitudes, las aprobadas sin evento
 * en Agrupaciones, y las que ya tienen evento sin dictar en Pendientes: cada una
 * se gestiona en su pestaña, y el histórico es lo que ya ocurrió.
 *
 * `NivelacionHistory` es un array JSONB por alumno: se expande con
 * `jsonb_array_elements` para que cada nivelación cerrada sea una fila propia.
 * Las entradas viejas (cerradas desde /sesion) no guardaron módulo/lección; se
 * muestran vacías en vez de inventarlas.
 */
const MAX_ROWS = 5000

// Identidad del alumno y su guía ACTUAL (derivado, no copiado: si el alumno
// cambia de salón, el historial refleja quién lo tiene hoy).
const IDENT = `
    a."_id" AS "academicaId",
    p."tipoCurso" AS curso,
    TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
    p."salon",
    cc."guia" AS "guiaId",
    g."nombreCompleto" AS guia`

const JOINS = `
    FROM "ACADEMICA" a
    JOIN "PEOPLE" p ON p."_id" = a."peopleId"
    LEFT JOIN "CURSOS_CAMPAIGN" cc
      ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
    LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"`

const NO_PRB = `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const guia = (searchParams.get('guia') || '').trim()
  const curso = (searchParams.get('curso') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const params: any[] = []
  let i = 1
  const extra: string[] = []
  if (guia)  { extra.push(`"guiaId" = $${i++}`); params.push(guia) }
  if (curso) { extra.push(`curso = $${i++}`); params.push(curso) }
  if (startDate) { extra.push(`fecha >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { extra.push(`fecha < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  const filtro = extra.length ? `WHERE ${extra.join(' AND ')}` : ''

  const rows = (await query(
    `WITH todas AS (
       -- Cerradas: una fila por entrada del historial
       SELECT ${IDENT},
              (h->>'fecha')::timestamptz AS fecha,
              (h->>'fechaEvento') AS "fechaEvento",
              h->>'resultado' AS estado,
              h->>'modulo' AS modulo,
              h->>'leccion' AS leccion,
              COALESCE((h->>'conteo')::int, 0) AS conteo,
              h->>'comentario' AS comentario,
              h->>'marcadoPor' AS "marcadoPor"
         ${JOINS}
         CROSS JOIN LATERAL jsonb_array_elements(a."NivelacionHistory") AS h
        WHERE ${NO_PRB} AND jsonb_typeof(a."NivelacionHistory") = 'array'

     )
     SELECT * FROM todas
     ${filtro}
     ORDER BY fecha DESC NULLS LAST, curso ASC NULLS LAST, nombre ASC
     LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Catálogos sobre el universo completo (sin los filtros aplicados), para que
  // el usuario pueda volver a ampliar la consulta después de acotarla.
  const opts = (await query(
    `SELECT DISTINCT p."tipoCurso" AS curso, cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       ${JOINS}
      WHERE ${NO_PRB}
        AND jsonb_array_length(COALESCE(a."NivelacionHistory", '[]'::jsonb)) > 0`
  )).rows
  const cursos = Array.from(new Set(opts.map((o: any) => o.curso).filter(Boolean))).sort()
  const guias = Array.from(
    new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values()
  )

  return successResponse({ rows, total: rows.length, cursos, guias })
})
