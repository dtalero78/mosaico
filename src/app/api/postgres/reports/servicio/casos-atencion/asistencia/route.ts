import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'
import { TIPOS_FUERA_DE_CASOS_SQL } from '@/lib/tipos-sesion'
import { INICIO_CAMPANAS_DOS_BLOQUES, INICIO_DOS_BLOQUES } from '@/lib/bloques-leccion'

/**
 * GET /api/postgres/reports/servicio/casos-atencion/asistencia
 *   ?curso&salon&leccion&guia&startDate&endDate
 *
 * Pestaña "Asistencia": estudiantes con DOS FALTAS CONSECUTIVAS a sesiones, dentro
 * del período (por defecto la semana pasada y la en curso). Sólo se cuentan sesiones
 * que YA ocurrieron y no fueron canceladas — una clase que aún no empieza no es
 * inasistencia. Una falta suelta, con asistencia antes y después, no aparece — salvo en los
 * sábados de dos lecciones, donde faltar un sábado ya son dos faltas.
 *
 * Trae además la gestión de Servicio (INASISTENCIA_GESTION): si ya se contactó al
 * apoderado y si ya se envió el recordatorio por WhatsApp.
 * Gateado por SERVICIO.CASOS_ATENCION.VER.
 */
const MAX_ROWS = 5000

// Secuencia de clases de cada alumno (últimos 120 días, ya dictadas y no canceladas):
// marca si faltó y si faltó también la clase anterior o la siguiente. Una inasistencia
// sólo es "caso" cuando forma parte de DOS FALTAS CONSECUTIVAS.
const SEQ_JOIN = `JOIN (
  SELECT s."bid", s."falto",
         LAG(s."falto")  OVER w AS "prevFalto",
         LEAD(s."falto") OVER w AS "nextFalto"
    FROM (
      SELECT b2."_id" AS "bid", COALESCE(b2."idEstudiante", b2."studentId") AS "est",
             COALESCE(c2."dia", b2."fechaEvento") AS "fecha",
             (COALESCE(b2."asistio", false) = false AND COALESCE(b2."asistencia", false) = false) AS "falto"
        FROM "ACADEMICA_BOOKINGS" b2
        LEFT JOIN "CALENDARIO" c2 ON c2."_id" = COALESCE(b2."eventoId", b2."idEvento")
       WHERE COALESCE(b2."cancelo", false) = false
         AND COALESCE(c2."dia", b2."fechaEvento") < NOW()
         AND COALESCE(c2."dia", b2."fechaEvento") >= NOW() - INTERVAL '120 days'
         AND UPPER(COALESCE(c2."tipo", b2."tipo", b2."tipoEvento", 'SESSION')) NOT IN (${TIPOS_FUERA_DE_CASOS_SQL})
    ) s
  WINDOW w AS (PARTITION BY s."est" ORDER BY s."fecha")
) seq ON seq."bid" = b."_id"`

// Los mismos tipos que cuentan como "sesión" en el resto del motor académico.
const ES_SESION = `UPPER(COALESCE(c."tipo", b."tipo", b."tipoEvento", 'SESSION')) NOT IN (${TIPOS_FUERA_DE_CASOS_SQL})`

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
    // Sólo faltas que completan DOS CONSECUTIVAS (la clase anterior o la siguiente también faltó).
    // Un sábado de dos lecciones (campañas desde agosto, desde el 21-ago) son DOS sesiones: una sola
    // falta ya cuenta como dos consecutivas.
    `seq."falto" AND (COALESCE(seq."prevFalto", false) OR COALESCE(seq."nextFalto", false)
       OR (p."horarioCurso" ~* '^S[ÁA]B' AND cc."inicioCurso" >= DATE '${INICIO_CAMPANAS_DOS_BLOQUES}'
           AND COALESCE(c."dia", b."fechaEvento") >= DATE '${INICIO_DOS_BLOQUES}'))`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    // Toda inasistencia se muestra, se repita o no, salvo que el alumno tenga un caso
    // cerrado con la marca 'No reportar asistencia' (usuario NO continúa con el curso).
    `NOT EXISTS (SELECT 1 FROM "CASOS_ATENCION" nc WHERE nc."academicaId" = a."_id" AND nc."noContinua" IS TRUE)`,
  ]
  const params: any[] = []
  let i = 1

  // Sin rango explícito: la semana pasada y la en curso (lunes-domingo, hora Chile).
  if (startDate) { where.push(`COALESCE(c."dia", b."fechaEvento") >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`COALESCE(c."dia", b."fechaEvento") < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  if (!startDate && !endDate) {
    where.push(`COALESCE(c."dia", b."fechaEvento") >= (date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) - INTERVAL '7 days') AT TIME ZONE 'America/Santiago'`)
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
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', usuario, i, 'p."contrato"')
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
            COALESCE(b."escusa", false) AS "justificada", b."justificaescusa" AS "motivoJustificacion",
            COALESCE(ig."recordatorioEnviado", false) AS "recordatorioEnviado",
            ig."recordatorioEn"
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       ${SEQ_JOIN}
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
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
       ${SEQ_JOIN}
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
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
