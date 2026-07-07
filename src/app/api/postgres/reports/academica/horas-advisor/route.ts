import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { queryMany } from '@/lib/postgres'
import { InformesPermission } from '@/types/permissions'

/**
 * GET /api/postgres/reports/academica/horas-advisor
 *
 * Informe de horas Advisor: por cada advisor cuenta sus sesiones por estado
 * (conducted/suspended/cancelled) y desglosa conducted por tipo de evento.
 *
 *   - Conducted  = eventos vigentes en CALENDARIO (desglosados por tipo)
 *   - Cancelled  = ADVISOR_EVENT_LOG estado='Canceled'  (cambio de advisor)
 *   - Suspended  = ADVISOR_EVENT_LOG estado='Suspended' (cancelación del evento)
 *   - Total      = conducted + suspended + cancelled
 *
 * Filtros: fechas, país (ADVISORS.pais), advisor, tipo de evento.
 * numeroId del advisor se resuelve por la relación ADVISORS.usuarioRolId ->
 * USUARIOS_ROLES._id (fallback por email para registros aún no enlazados).
 *
 * Gateado por INFORMES.ACADEMICA.HORAS_ADVISOR (SUPER_ADMIN/ADMIN bypass).
 */

const TIPOS = ['sesiones', 'jumps', 'training', 'clubes', 'welcome', 'essential', 'otros'] as const
type Tipo = typeof TIPOS[number]
const TIPO_FILTROS = ['all', ...TIPOS]

interface HorasAdvisorRow {
  advisorId: string
  advisorNombre: string
  plataforma: string | null
  numeroId: string | null
  activo: boolean
  sesiones: number
  jumps: number
  training: number
  clubes: number
  welcome: number
  essential: number
  otros: number
  conducted: number
  suspended: number
  cancelled: number
  total: number
}

/** CASE que clasifica cada evento en un tipo. `cols` mapea las columnas según la tabla. */
function tipoExpr(cols: { nivel: string; tipo: string; titulos: string[]; step: string }): string {
  const tituloMatch = (pat: string) => cols.titulos.map(t => `${t} ILIKE '${pat}'`).join(' OR ')
  const numStep = `NULLIF(REGEXP_REPLACE(${cols.step}, '[^0-9]', '', 'g'), '')`
  return `
    CASE
      WHEN ${cols.nivel} = 'ESS' AND ${cols.tipo} = 'SESSION' THEN 'essential'
      WHEN (${cols.nivel} = 'WELCOME' OR ${cols.tipo} = 'WELCOME' OR ${tituloMatch('%WELCOME%')}) THEN 'welcome'
      WHEN ${cols.tipo} = 'CLUB' AND (${tituloMatch('TRAINING -%')}) THEN 'training'
      WHEN ${cols.tipo} = 'CLUB' THEN 'clubes'
      WHEN ${cols.tipo} = 'SESSION'
        AND ${cols.nivel} IS DISTINCT FROM 'WELCOME' AND ${cols.nivel} IS DISTINCT FROM 'ESS'
        AND ${numStep} IS NOT NULL AND ${numStep}::int % 5 = 0 THEN 'jumps'
      WHEN ${cols.tipo} = 'SESSION'
        AND ${cols.nivel} IS DISTINCT FROM 'WELCOME' AND ${cols.nivel} IS DISTINCT FROM 'ESS' THEN 'sesiones'
      ELSE 'otros'
    END`
}

const CAL_TIPO = tipoExpr({ nivel: 'c."nivel"', tipo: 'c."tipo"', titulos: ['c."nombreEvento"', 'c."tituloONivel"'], step: 'c."step"' })
const LOG_TIPO = tipoExpr({ nivel: 'l."nivel"', tipo: 'l."tipo"', titulos: ['l."tituloEvento"'], step: 'l."step"' })

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, InformesPermission.ACAD_HORAS_ADVISOR)

  const { searchParams } = new URL(req.url)
  const fechaInicio = searchParams.get('fechaInicio') || `${new Date().getFullYear()}-01-01`
  const fechaFin    = searchParams.get('fechaFin')    || new Date().toISOString().substring(0, 10)
  const plataforma  = searchParams.get('plataforma')  || null
  const advisorId   = searchParams.get('advisorId')   || null
  const tipoRaw     = searchParams.get('tipo') || 'all'
  const tipo        = TIPO_FILTROS.includes(tipoRaw) ? tipoRaw : 'all'

  const params: any[] = [fechaInicio, fechaFin, plataforma, advisorId, tipo]

  const sql = `
    WITH conducted AS (
      SELECT a."_id" AS advisor_id,
        COUNT(*) FILTER (WHERE t.tipo = 'sesiones')::int  AS sesiones,
        COUNT(*) FILTER (WHERE t.tipo = 'jumps')::int     AS jumps,
        COUNT(*) FILTER (WHERE t.tipo = 'training')::int  AS training,
        COUNT(*) FILTER (WHERE t.tipo = 'clubes')::int    AS clubes,
        COUNT(*) FILTER (WHERE t.tipo = 'welcome')::int   AS welcome,
        COUNT(*) FILTER (WHERE t.tipo = 'essential')::int AS essential,
        COUNT(*) FILTER (WHERE t.tipo = 'otros')::int     AS otros,
        COUNT(*)::int AS conducted
      FROM "CALENDARIO" c
      JOIN "GUIAS" a ON a."_id" = c."advisor" OR LOWER(a."email") = LOWER(c."advisor")
      CROSS JOIN LATERAL (SELECT (${CAL_TIPO}) AS tipo) t
      WHERE c."dia" >= $1::date AND c."dia" < ($2::date + interval '1 day')
        AND ($5::text = 'all' OR t.tipo = $5)
      GROUP BY a."_id"
    ),
    logs AS (
      SELECT a."_id" AS advisor_id,
        COUNT(*) FILTER (WHERE l."estado" = 'Canceled')::int  AS cancelled,
        COUNT(*) FILTER (WHERE l."estado" = 'Suspended')::int AS suspended
      FROM "ADVISOR_EVENT_LOG" l
      JOIN "GUIAS" a ON a."_id" = l."advisorId" OR LOWER(a."email") = LOWER(l."advisorId")
      CROSS JOIN LATERAL (SELECT (${LOG_TIPO}) AS tipo) t
      WHERE l."fechaEvento" >= $1::date AND l."fechaEvento" < ($2::date + interval '1 day')
        AND ($5::text = 'all' OR t.tipo = $5)
      GROUP BY a."_id"
    ),
    combined AS (
      -- Solo advisors CON actividad en el rango (conducted o log). Los advisors
      -- activos sin horas (ej. Super Advisor) NO aparecen en lista/gráficas.
      -- Los inactivos aparecen únicamente si tuvieron agendamientos (nombre rojo).
      SELECT advisor_id FROM conducted
      UNION
      SELECT advisor_id FROM logs
    )
    SELECT
      a."_id" AS "advisorId",
      COALESCE(NULLIF(TRIM(a."nombreCompleto"), ''),
               NULLIF(TRIM(CONCAT(a."primerNombre", ' ', a."primerApellido")), ''),
               a."_id") AS "advisorNombre",
      a."pais" AS "plataforma",
      COALESCE(a."activo", false) AS "activo",
      COALESCE(url."numberid", ure."numberid") AS "numeroId",
      COALESCE(co.sesiones, 0)  AS "sesiones",
      COALESCE(co.jumps, 0)     AS "jumps",
      COALESCE(co.training, 0)  AS "training",
      COALESCE(co.clubes, 0)    AS "clubes",
      COALESCE(co.welcome, 0)   AS "welcome",
      COALESCE(co.essential, 0) AS "essential",
      COALESCE(co.otros, 0)     AS "otros",
      COALESCE(co.conducted, 0) AS "conducted",
      COALESCE(lo.suspended, 0) AS "suspended",
      COALESCE(lo.cancelled, 0) AS "cancelled",
      COALESCE(co.conducted, 0) + COALESCE(lo.suspended, 0) + COALESCE(lo.cancelled, 0) AS "total"
    FROM combined cb
    JOIN "GUIAS" a ON a."_id" = cb.advisor_id
    LEFT JOIN conducted co ON co.advisor_id = a."_id"
    LEFT JOIN logs lo ON lo.advisor_id = a."_id"
    LEFT JOIN "USUARIOS_ROLES" url ON url."_id" = a."usuarioRolId"
    LEFT JOIN LATERAL (
      SELECT "numberid" FROM "USUARIOS_ROLES"
      WHERE LOWER("email") = LOWER(a."email") AND "numberid" IS NOT NULL
      LIMIT 1
    ) ure ON true
    WHERE ($3::text IS NULL OR a."pais" = $3)
      AND ($4::text IS NULL OR a."_id" = $4)
    ORDER BY "total" DESC, "advisorNombre" ASC
  `

  const rows = await queryMany<HorasAdvisorRow>(sql, params)
  const n = (v: any) => Number(v) || 0

  // Conteo de advisors ACTIVOS en el scope de país (roster), independiente de
  // si tuvieron actividad — alimenta el KPI "Advisors Activos".
  const activosRows = await queryMany<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "GUIAS"
     WHERE "activo" = true AND ($1::text IS NULL OR "pais" = $1)`,
    [plataforma],
  )
  const advisorsActivos = activosRows[0]?.n ?? 0

  // ── Totales ──
  const totals = {
    sesiones:  rows.reduce((s, r) => s + n(r.sesiones), 0),
    jumps:     rows.reduce((s, r) => s + n(r.jumps), 0),
    training:  rows.reduce((s, r) => s + n(r.training), 0),
    clubes:    rows.reduce((s, r) => s + n(r.clubes), 0),
    welcome:   rows.reduce((s, r) => s + n(r.welcome), 0),
    essential: rows.reduce((s, r) => s + n(r.essential), 0),
    otros:     rows.reduce((s, r) => s + n(r.otros), 0),
    conducted: rows.reduce((s, r) => s + n(r.conducted), 0),
    suspended: rows.reduce((s, r) => s + n(r.suspended), 0),
    cancelled: rows.reduce((s, r) => s + n(r.cancelled), 0),
    total:     rows.reduce((s, r) => s + n(r.total), 0),
    // Conteos de advisors
    advisorsActivos,                                                // roster activo (país)
    advisorsConActividad:          rows.length,                     // aparecen en lista/gráficas
    advisorsInactivosConActividad: rows.filter(r => !r.activo).length, // nombre en rojo
  }

  // ── Charts ──
  // Barras horizontales por advisor (estado)
  const barByAdvisor = rows.map(r => ({
    name:     r.advisorNombre.length > 18 ? `${r.advisorNombre.slice(0, 17)}…` : r.advisorNombre,
    fullName: r.advisorNombre,
    conducted: n(r.conducted),
    suspended: n(r.suspended),
    cancelled: n(r.cancelled),
  }))

  // Dona por estado (total + %)
  const donut = [
    { name: 'Conducted', value: totals.conducted },
    { name: 'Suspended', value: totals.suspended },
    { name: 'Cancelled', value: totals.cancelled },
  ].filter(d => d.value > 0)

  // Composición de conducted por tipo (gráfica nueva)
  const byType = [
    { name: 'Sesiones',  value: totals.sesiones },
    { name: 'Jumps',     value: totals.jumps },
    { name: 'Training',  value: totals.training },
    { name: 'Clubes',    value: totals.clubes },
    { name: 'Welcome',   value: totals.welcome },
    { name: 'Essential', value: totals.essential },
    { name: 'Otros',     value: totals.otros },
  ].filter(d => d.value > 0)

  // ── Meta dropdowns ──
  const plataformas = await queryMany<{ pais: string }>(
    `SELECT DISTINCT "pais" FROM "GUIAS" WHERE "pais" IS NOT NULL AND TRIM("pais") <> '' ORDER BY "pais"`,
    [],
  )
  const advisors = await queryMany<{ _id: string; nombreCompleto: string; pais: string | null }>(
    `SELECT "_id", "nombreCompleto", "pais" FROM "GUIAS" WHERE "activo" = true ORDER BY "nombreCompleto"`,
    [],
  )

  return successResponse({
    table: rows,
    totals,
    charts: { barByAdvisor, donut, byType },
    meta: { plataformas: plataformas.map(p => p.pais), advisors },
  })
})
