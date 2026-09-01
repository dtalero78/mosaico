import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ValidationError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import {
  ESTADOS_CIERRE, ESTADOS_ACADEMICOS, ESTADOS_FINANCIEROS,
} from '@/lib/casos-atencion-estados'

/**
 * GET .../casos-atencion/gestiones?area=historico|academicos|financieros
 *     &curso&salon&leccion&guia&startDate&endDate
 *
 * Las tres pestañas que se alimentan del ESTADO del caso, no de la marca del
 * agendamiento. Un solo endpoint porque las tres devuelven exactamente las mismas
 * columnas y sólo cambia el conjunto de estados que miran; tres endpoints con la
 * misma consulta habrían divergido al primer ajuste.
 *
 *  - `historico`   → todos los estados de cierre (el último mes por defecto)
 *  - `academicos`  → Cambio Curso · Cambio de Nivel · Solicitud Congelamiento
 *  - `financieros` → Cierre financiero · Envío Pre-jurídico
 *
 * Académicos y Financieros **no llevan corte de tiempo por defecto**: son bandejas
 * de trabajo pendiente, y esconder lo de hace cinco semanas dejaría gestiones sin
 * hacer fuera de la vista. El Histórico sí lo lleva, porque es consulta.
 *
 * El contexto administrativo (curso, salón, guía) se DERIVA en cada lectura desde
 * PEOPLE y CURSOS_CAMPAIGN, igual que en el resto del módulo: copiarlo al caso lo
 * dejaría desfasado en cuanto el alumno cambie de salón.
 */
const MAX_ROWS = 5000

const AREAS: Record<string, string[]> = {
  historico: ESTADOS_CIERRE,
  academicos: ESTADOS_ACADEMICOS,
  financieros: ESTADOS_FINANCIEROS,
}

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_VER)

  const { searchParams } = new URL(request.url)
  const area = (searchParams.get('area') || 'historico').trim()
  const estados = AREAS[area]
  if (!estados) throw new ValidationError('Área no válida')

  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const params: any[] = [estados]
  let i = 2
  const where: string[] = [
    `ca."estado"::text = ANY($1)`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
  ]

  // La fecha de referencia es la del cierre; `_updatedDate` cubre los casos
  // cerrados antes de que existiera la columna.
  const FECHA = `COALESCE(ca."cerradoEn", ca."_updatedDate", ca."_createdDate")`
  if (startDate) { where.push(`${FECHA} >= $${i++}::date`); params.push(startDate) }
  if (endDate)   { where.push(`${FECHA} < ($${i++}::date + INTERVAL '1 day')`); params.push(endDate) }
  if (area === 'historico' && !startDate && !endDate) {
    where.push(`${FECHA} >= NOW() - INTERVAL '1 month'`)
  }

  if (curso)   { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)   { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (leccion) { where.push(`COALESCE(c."sesionLeccion", c."step") = $${i++}`); params.push(leccion) }
  if (guia)    { where.push(`cc."guia" = $${i++}`); params.push(guia) }

  const from = `
       FROM "CASOS_ATENCION" ca
       JOIN "ACADEMICA" a ON a."_id" = ca."academicaId"
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = ca."eventoOrigenId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"`
  const whereSql = `WHERE ${where.join(' AND ')}`
  const base = `${from} ${whereSql}`

  const rows = (await query(
    `SELECT ca."_id" AS "casoId",
            ca."codigo" AS "codigoCaso",
            ca."estado"::text AS estado,
            ca."acuerdo",
            ca."cerradoPor",
            ${FECHA} AS "fechaEstado",
            a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\s+', ' ', 'g')) AS nombre,
            p."numeroId" AS "numeroId",
            p."contrato",
            tit."_id" AS "titularId",
            p."salon",
            COALESCE(c."sesionLeccion", c."step") AS leccion,
            g."nombreCompleto" AS guia
       ${from}
       LEFT JOIN LATERAL (
         SELECT t."_id" FROM "PEOPLE" t
          WHERE t."contrato" = p."contrato" AND t."tipoUsuario" = 'TITULAR' LIMIT 1
       ) tit ON true
      ${whereSql}
      ORDER BY curso ASC NULLS LAST, "fechaEstado" DESC NULLS LAST, nombre ASC
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // El desglose por estado se muestra en la cabecera: en una pestaña que junta
  // varios estados, el total solo no dice cuánto hay de cada gestión.
  const porEstado = (await query(
    `SELECT ca."estado"::text AS estado, COUNT(*)::int AS n ${base} GROUP BY 1`,
    params
  )).rows

  // Opciones de los dropdowns, acotadas al área para no ofrecer un filtro que
  // devolvería vacío.
  const opts = (await query(
    `SELECT DISTINCT p."tipoCurso" AS curso, p."salon" AS salon,
            COALESCE(c."sesionLeccion", c."step") AS leccion,
            cc."guia" AS guia_id, g."nombreCompleto" AS guia_nombre
       FROM "CASOS_ATENCION" ca
       JOIN "ACADEMICA" a ON a."_id" = ca."academicaId"
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CALENDARIO" c ON c."_id" = ca."eventoOrigenId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ca."estado"::text = ANY($1) AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    [estados]
  )).rows

  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean)))
  return successResponse({
    rows,
    total: rows.length,
    porEstado,
    cursos: uniq(opts.map((o: any) => o.curso)).sort(),
    salones: uniq(opts.map((o: any) => o.salon)).sort(),
    lecciones: uniq(opts.map((o: any) => o.leccion)).sort(),
    guias: Array.from(new Map(
      opts.filter((o: any) => o.guia_id).map((o: any) => [o.guia_id, { id: o.guia_id, nombre: o.guia_nombre }])
    ).values()),
  })
})
