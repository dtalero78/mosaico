import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { cupoOcupadoSql } from '@/lib/cupo'
import { ServicioPermission } from '@/types/permissions'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'

/**
 * GET /api/postgres/reports/servicio/casos-atencion/asistencia
 *   ?curso&salon&leccion&guia&startDate&endDate
 *
 * Pestaña "Asistencia": estudiantes que NO asistieron a las sesiones de la
 * SEMANA (lunes-domingo, hora Chile). Sólo se cuentan sesiones que YA ocurrieron
 * y que no fueron canceladas — una clase que aún no empieza no es inasistencia.
 *
 * Trae además la gestión de Servicio (INASISTENCIA_GESTION): si ya se contactó al
 * apoderado y si ya se envió el recordatorio por WhatsApp.
 * Gateado por SERVICIO.CASOS_ATENCION.VER.
 */
const MAX_ROWS = 5000

// Los mismos tipos que cuentan como "sesión" en el resto del motor académico.
const ES_SESION = `UPPER(COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION')) NOT IN ('CLUB','NIVELACION','COMPLEMENTARIA','WELCOME','OLIMPIADA')`

// En los cursos MOSAICO el evento guarda la lección en `sesionLeccion`/`sesionModulo`
// (CALENDARIO."step" queda NULL); `b."step"` es el respaldo para datos antiguos.
const LECCION = `COALESCE(c."sesionLeccion", c."step", b."step")`
// NIVELES escribe "Leccion 17" y el evento "Lección 28": se comparan sin acentos.
const sinAcentos = (x: string) => `translate(lower(${x}), 'áéíóú', 'aeiou')`

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_VER)

  const { searchParams } = new URL(request.url)
  const campaign = (searchParams.get('campaign') || '').trim()
  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const usuario = (searchParams.get('usuario') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const where: string[] = [
    // No asistió (ninguna de las dos marcas) y no canceló.
    `COALESCE(b."asistio", false) = false`,
    `COALESCE(b."asistencia", false) = false`,
    `COALESCE(b."cancelo", false) = false`,
    // La sesión ya ocurrió.
    `COALESCE(c."dia", b."fechaEvento") < NOW()`,
    ES_SESION,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    // Sólo los que ocupan cupo (ver lib/cupo): a quien ya soltó el salón no se le
    // reclama la inasistencia.
    cupoOcupadoSql('p'),
  ]
  const params: any[] = []
  let i = 1

  // Sin rango explícito: la semana en curso (lunes-domingo, hora Chile).
  if (startDate) { where.push(`COALESCE(c."dia", b."fechaEvento") >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`COALESCE(c."dia", b."fechaEvento") < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  if (!startDate && !endDate) {
    where.push(`COALESCE(c."dia", b."fechaEvento") >= date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) AT TIME ZONE 'America/Santiago'`)
    where.push(`COALESCE(c."dia", b."fechaEvento") < (date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) + INTERVAL '7 days') AT TIME ZONE 'America/Santiago'`)
  }

  // Las opciones de los dropdowns salen del universo SIN los filtros elegidos:
  // si salieran de lo ya filtrado, al elegir una campaña desaparecerían las
  // demás y no se podría cambiar sin borrar los filtros.
  const whereBase = [...where]
  const paramsBase = [...params]

  if (campaign) { where.push(`p."campaign" = $${i++}`); params.push(campaign) }
  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)   { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`${LECCION} = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }
  if (usuario) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', usuario, i)
    where.push(c.sql); params.push(...c.params); i += 2
  }

  const rows = (await query(
    `SELECT b."_id" AS "bookingId",
            a."_id" AS "academicaId",
            p."campaign" AS campaign,
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId" AS "numeroId",
            p."salon",
            ${LECCION} AS leccion,
            c."sesionModulo" AS modulo,
            n."description" AS tema,
            g."nombreCompleto" AS guia,
            COALESCE(c."dia", b."fechaEvento") AS fecha,
            p."apoderado", p."apoderadoTelefono", p."celular",
            COALESCE(ig."contactadoApoderado", false) AS "contactadoApoderado",
            ig."contactadoEn", ig."contactadoPor",
            COALESCE(ig."recordatorioEnviado", false) AS "recordatorioEnviado",
            ig."recordatorioEn"
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n
         ON UPPER(n."curso") = UPPER(p."tipoCurso")
        AND ${sinAcentos('n."step"')} = ${sinAcentos(LECCION)}
        AND (c."sesionModulo" IS NULL OR ${sinAcentos('n."code"')} = ${sinAcentos('c."sesionModulo"')})
       LEFT JOIN "INASISTENCIA_GESTION" ig ON ig."bookingId" = b."_id"
      WHERE ${where.join(' AND ')}
      ORDER BY fecha DESC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones: mismo universo y mismas fechas, pero sin los filtros elegidos.
  const opts = (await query(
    `SELECT DISTINCT p."campaign" AS campaign, p."tipoCurso" AS curso, p."salon" AS salon,
            ${LECCION} AS leccion, g."nombreCompleto" AS guia
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${whereBase.join(' AND ')}`,
    paramsBase
  )).rows

  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  const campanias = uniq(opts.map((o: any) => o.campaign)).sort()
  const cursos = uniq(opts.map((o: any) => o.curso)).sort()
  const salones = uniq(opts.map((o: any) => o.salon)).sort()
  const lecciones = uniq(opts.map((o: any) => o.leccion)).sort()
  const guias = Array.from(new Map(
    opts.filter((o: any) => o.guia).map((o: any) => [o.guia, { id: o.guia, nombre: o.guia }])
  ).values())

  return successResponse({ rows, total: rows.length, campanias, cursos, salones, lecciones, guias })
})
