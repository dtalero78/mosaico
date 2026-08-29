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
 * tenga un agendamiento no cancelado en un evento `tipo='NIVELACION'`. Copiarlo
 * a una bandera lo dejaría desfasado en cuanto el evento se borre o el
 * agendamiento se cancele. Los que YA tienen evento no desaparecen: pasan a la
 * pestaña **Pendientes**, hasta que se dicte y se marque asistencia.
 *
 * Se devuelven además campaña / horario / salón porque son el alcance con el
 * que se creará el evento del grupo.
 */
const MAX_ROWS = 5000

/**
 * Alumnos que YA tienen su nivelación agendada.
 *
 * Se resuelve en DOS consultas cortas en vez de en un `NOT EXISTS`
 * correlacionado: ese recorría los ~165k agendamientos por cada alumno y
 * tardaba 30 segundos. Los eventos de nivelación son un puñado, así que se
 * listan primero y se pasan como arreglo: con `= ANY($1)` en cada columna y
 * un OR explícito, Postgres combina los dos índices (BitmapOr) — el mismo
 * patrón que usa `booking.repository`. `idEstudiante` y `studentId` se miran
 * ambos porque el enlace legacy de Wix usa el segundo.
 */
async function idsConNivelacionAgendada(): Promise<string[]> {
  const eventos = (await query<{ _id: string }>(
    `SELECT "_id" FROM "CALENDARIO" WHERE UPPER(COALESCE("tipo", '')) = 'NIVELACION'`
  )).rows.map((e) => e._id)
  if (!eventos.length) return []
  const filas = (await query<{ idEstudiante: string | null; studentId: string | null }>(
    `SELECT DISTINCT b."idEstudiante", b."studentId"
       FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
        AND b."cancelo" IS NOT TRUE`,
    [eventos]
  )).rows
  const ids = new Set<string>()
  for (const f of filas) {
    if (f.idEstudiante) ids.add(f.idEstudiante)
    if (f.studentId) ids.add(f.studentId)
  }
  return Array.from(ids)
}

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()

  const agendadas = await idsConNivelacionAgendada()

  const where: string[] = [
    `a."aprobadoNivelacion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    `a."_id" <> ALL($1::text[])`,
  ]
  const params: any[] = [agendadas]
  let i = 2
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
            (a."detalleNivelacion"->>'hora') AS hora,
            (a."detalleNivelacion"->>'motivo') AS motivo,
            (a."detalleNivelacion"->>'confirmadoEn') AS "confirmadoEn",
            (a."detalleNivelacion"->>'confirmadoPor') AS "confirmadoPor",
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
        AND a."_id" <> ALL($1::text[])`,
    [agendadas]
  )).rows
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean))).sort()
  const cursos = uniq(opts.map((o: any) => o.curso))
  const lecciones = uniq(opts.map((o: any) => o.leccion))
  const guias = Array.from(
    new Map(opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])).values()
  )

  return successResponse({ rows, total: rows.length, cursos, lecciones, guias })
})
