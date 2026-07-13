import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { AcademicoPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/academico/lista-usuarios?campaign&curso&salon&startDate&endDate
 *
 * Lista de usuarios (beneficiarios) con filtros por campaña, curso, salón y rango
 * de fecha de contrato. Columnas: nombre, fecha nacimiento, edad (calculada),
 * apoderado, módulo actual y lección actual.
 *
 * Módulo/lección "actual": si ACADEMICA sigue en el curso puente WELCOME (o no hay
 * registro), se usa el módulo/lección real de PEOPLE (posición inicial del curso);
 * si ya fue promovido, se usa el de ACADEMICA. El curso/salón/campaña reales viven
 * en PEOPLE. Gateado por ACADEMICO.LISTA_USUARIOS.VER.
 */
const MAX_ROWS = 8000

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, AcademicoPermission.LISTA_USUARIOS_VER)

  const { searchParams } = new URL(request.url)
  const campaign = (searchParams.get('campaign') || '').trim()
  const curso = (searchParams.get('curso') || '').trim()
  const salon = (searchParams.get('salon') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const startDate = (searchParams.get('startDate') || '').trim()
  const endDate = (searchParams.get('endDate') || '').trim()

  const where: string[] = [
    `p."tipoUsuario" = 'BENEFICIARIO'`,
    `COALESCE(p."contrato", '') NOT LIKE 'PRB-%'`,
  ]
  const params: any[] = []
  let i = 1
  if (campaign) { where.push(`p."campaign" = $${i++}`); params.push(campaign) }
  if (curso)    { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (salon)    { where.push(`p."salon" = $${i++}`); params.push(salon) }
  if (guia)     { where.push(`cc."guia" = $${i++}`); params.push(guia) }
  if (startDate){ where.push(`p."fechaContrato" >= $${i++}::date`); params.push(startDate) }
  if (endDate)  { where.push(`p."fechaContrato" <= $${i++}::date`); params.push(endDate) }

  const rows = (await query(
    `SELECT
       p."_id" AS id, p."numeroId",
       TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
       p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido",
       p."fechaNacimiento"::text AS "fechaNacimiento",
       CASE WHEN p."fechaNacimiento" IS NOT NULL
            THEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, p."fechaNacimiento"::date))::int END AS edad,
       p."apoderado", p."apoderadoTelefono", p."apoderadoMail",
       p."email", p."celular", p."domicilio", p."ciudad",
       a."_id" AS "academicaId",
       COALESCE(NULLIF(CASE WHEN a."curso" = 'WELCOME' OR a."curso" IS NULL THEN p."nivel" ELSE a."nivel" END, ''), p."nivel") AS modulo,
       COALESCE(NULLIF(CASE WHEN a."curso" = 'WELCOME' OR a."curso" IS NULL THEN p."step"  ELSE a."step"  END, ''), p."step")  AS leccion,
       p."tipoCurso" AS curso, p."salon", p."campaign",
       g."nombreCompleto" AS guia,
       p."fechaContrato"::text AS "fechaContrato"
     FROM "PEOPLE" p
     LEFT JOIN LATERAL (
       SELECT "_id", "curso", "nivel", "step" FROM "ACADEMICA" WHERE "peopleId" = p."_id" LIMIT 1
     ) a ON true
     LEFT JOIN "CURSOS_CAMPAIGN" cc
       ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
     LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
     WHERE ${where.join(' AND ')}
     ORDER BY nombre ASC
     LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // Opciones para los dropdowns (independientes de los filtros aplicados)
  const campanias = (await query(
    `SELECT DISTINCT "campaign" AS v FROM "PEOPLE"
      WHERE "tipoUsuario"='BENEFICIARIO' AND "campaign" IS NOT NULL AND "campaign" <> ''
        AND COALESCE("contrato",'') NOT LIKE 'PRB-%' ORDER BY "campaign" DESC`
  )).rows.map((r: any) => r.v)
  const salones = (await query(
    `SELECT DISTINCT "salon" AS v FROM "PEOPLE"
      WHERE "tipoUsuario"='BENEFICIARIO' AND "salon" IS NOT NULL AND "salon" <> ''
        AND COALESCE("contrato",'') NOT LIKE 'PRB-%' ORDER BY "salon" ASC`
  )).rows.map((r: any) => r.v)
  // Guías asignados a cursos que tienen beneficiarios (para el dropdown)
  const guias = (await query(
    `SELECT DISTINCT g."_id" AS id, g."nombreCompleto" AS nombre
       FROM "PEOPLE" p
       JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE p."tipoUsuario"='BENEFICIARIO' AND COALESCE(p."contrato",'') NOT LIKE 'PRB-%'
      ORDER BY g."nombreCompleto" ASC`
  )).rows

  return successResponse({ rows, total: rows.length, campanias, salones, guias })
})
