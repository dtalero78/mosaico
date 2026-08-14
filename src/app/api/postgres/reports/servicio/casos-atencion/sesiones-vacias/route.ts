import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { cupoOcupadoSql } from '@/lib/cupo'
import { ServicioPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/servicio/casos-atencion/sesiones-vacias
 *   ?curso&salon&leccion&guia&startDate&endDate
 *
 * Pestaña "Sesiones vacías": sesiones de la SEMANA (lunes-domingo, hora Chile) que
 * YA ocurrieron y a las que NO asistió NINGÚN estudiante. El resultado viene
 * agrupado por curso y salón.
 *
 * El curso/salón de un evento se resuelve por su `cursoCampaignId` (los eventos de
 * curso lo llevan desde que se generan); las columnas `curso`/`salon` del propio
 * CALENDARIO se usan como respaldo para eventos antiguos.
 * Gateado por SERVICIO.CASOS_ATENCION.VER.
 */
const MAX_ROWS = 2000

const ES_SESION = `UPPER(COALESCE(c."tipo", 'SESSION')) NOT IN ('CLUB','NIVELACION','COMPLEMENTARIA','WELCOME','OLIMPIADA')`

// En los cursos MOSAICO la lección vive en `sesionLeccion`/`sesionModulo`
// (CALENDARIO."step" queda NULL en esos eventos).
const LECCION = `COALESCE(c."sesionLeccion", c."step")`
// NIVELES escribe "Leccion 17" y el evento "Lección 28": se comparan sin acentos.
const sinAcentos = (x: string) => `translate(lower(${x}), 'áéíóú', 'aeiou')`

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
    `c."dia" < NOW()`,
    ES_SESION,
    // Sólo eventos de un curso real (los sueltos no tienen salón que reportar).
    `c."cursoCampaignId" IS NOT NULL`,
  ]
  const params: any[] = []
  let i = 1

  if (startDate) { where.push(`c."dia" >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`c."dia" < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  if (!startDate && !endDate) {
    where.push(`c."dia" >= date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) AT TIME ZONE 'America/Santiago'`)
    where.push(`c."dia" < (date_trunc('week', (NOW() AT TIME ZONE 'America/Santiago')) + INTERVAL '7 days') AT TIME ZONE 'America/Santiago'`)
  }

  if (curso)   { where.push(`UPPER(COALESCE(cc."tipoCurso", c."curso")) = UPPER($${i++})`); params.push(curso) }
  if (salon)   { where.push(`COALESCE(cc."salon", c."salon") = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`${LECCION} = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }

  const rows = (await query(
    `SELECT c."_id" AS "eventoId",
            COALESCE(cc."tipoCurso", c."curso") AS curso,
            COALESCE(cc."salon", c."salon") AS salon,
            ${LECCION} AS leccion,
            c."sesionModulo" AS modulo,
            n."description" AS tema,
            g."nombreCompleto" AS guia,
            c."dia" AS fecha,
            c."nombreEvento", c."tituloONivel",
            ins."inscritos"::int AS inscritos
       FROM "CALENDARIO" c
       LEFT JOIN "CURSOS_CAMPAIGN" cc ON cc."_id" = c."cursoCampaignId"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
       LEFT JOIN "NIVELES" n
         ON UPPER(n."curso") = UPPER(COALESCE(cc."tipoCurso", c."curso"))
        AND ${sinAcentos('n."step"')} = ${sinAcentos(LECCION)}
        AND (c."sesionModulo" IS NULL OR ${sinAcentos('n."code"')} = ${sinAcentos('c."sesionModulo"')})
       JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE COALESCE(b."cancelo",false) = false) AS "inscritos",
                COUNT(*) FILTER (WHERE (COALESCE(b."asistio",false) OR COALESCE(b."asistencia",false))
                                   AND COALESCE(b."cancelo",false) = false) AS "asistieron"
           FROM "ACADEMICA_BOOKINGS" b
           JOIN "ACADEMICA" ab ON ab."_id" = COALESCE(b."idEstudiante", b."studentId")
          WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
            -- "Inscritos" = los que OCUPAN cupo, para no contar como inscrito a
            -- quien ya soltó el salón (retractado, OnHold o cupo liberado).
            AND NOT EXISTS (
              SELECT 1 FROM "PEOPLE" pb
               WHERE pb."numeroId" = ab."numeroId"
                 AND pb."tipoUsuario" IN ('BENEFICIARIO','BENEFICIARIA')
                 AND NOT (${cupoOcupadoSql('pb')})
            )
       ) ins ON true
      WHERE ${where.join(' AND ')}
        AND ins."asistieron" = 0
      ORDER BY curso ASC NULLS LAST, salon ASC NULLS LAST, c."dia" DESC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Agrupado por curso + salón (lo que pidió el reporte).
  const grupos: Array<{ curso: string; salon: string; sesiones: any[] }> = []
  const idx = new Map<string, number>()
  for (const r of rows as any[]) {
    const k = `${r.curso || '—'}|${r.salon || '—'}`
    if (!idx.has(k)) { idx.set(k, grupos.length); grupos.push({ curso: r.curso || '—', salon: r.salon || '—', sesiones: [] }) }
    grupos[idx.get(k)!].sesiones.push(r)
  }

  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  return successResponse({
    grupos, total: rows.length,
    cursos: uniq(rows.map((r: any) => r.curso)).sort(),
    salones: uniq(rows.map((r: any) => r.salon)).sort(),
    lecciones: uniq(rows.map((r: any) => r.leccion)).sort(),
    guias: Array.from(new Map(rows.filter((r: any) => r.guia).map((r: any) => [r.guia, { id: r.guia, nombre: r.guia }])).values()),
  })
})
