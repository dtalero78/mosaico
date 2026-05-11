import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany } from '@/lib/postgres'

type TipoFiltro = 'all' | 'sesiones' | 'jumps' | 'training' | 'essential' | 'welcome'

interface AdvisorRow {
  advisorNombre:  string
  advisorId:      string | null
  totalSesiones:  number
  totalJumps:     number
  totalTraining:  number
  totalEssential: number
  totalWelcome:   number
  totalGeneral:   number
  totalInscritos: number
  totalAsistentes: number
}

function safeDiv(num: number, den: number) {
  if (den === 0) return 0
  return Math.round((num / den) * 10000) / 100
}

/** SQL CASE that classifies each CALENDARIO row into a report type */
const TIPO_INFORME_EXPR = `
  CASE
    WHEN c."nivel" = 'ESS' AND c."tipo" = 'SESSION' THEN 'essential'
    WHEN (c."nivel" = 'WELCOME'
      OR c."tipo" = 'WELCOME'
      OR c."tituloONivel" ILIKE '%WELCOME%'
      OR c."nombreEvento"  ILIKE '%WELCOME%') THEN 'welcome'
    WHEN c."tipo" = 'CLUB'
      AND COALESCE(c."nombreEvento", c."tituloONivel",'') ILIKE 'TRAINING -%' THEN 'training'
    WHEN c."tipo" = 'SESSION'
      AND c."nivel" IS DISTINCT FROM 'WELCOME'
      AND c."step" IS NOT NULL
      AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'') IS NOT NULL
      AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int > 0
      AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int % 5 = 0
      THEN 'jumps'
    WHEN c."tipo" = 'SESSION'
      AND c."nivel" IS DISTINCT FROM 'WELCOME'
      AND c."nivel" IS DISTINCT FROM 'ESS'
      AND (
        c."step" IS NULL
        OR NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'') IS NULL
        OR NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int % 5 != 0
      ) THEN 'sesiones'
    ELSE NULL
  END
`

function tipoWhereClause(tipoFiltro: TipoFiltro): string {
  if (tipoFiltro === 'all') return ''
  return `AND (${TIPO_INFORME_EXPR}) = '${tipoFiltro}'`
}

export const GET = handlerWithAuth(async (req, _ctx, _session) => {
  const { searchParams } = new URL(req.url)
  const fechaInicio = searchParams.get('fechaInicio') ?? `${new Date().getFullYear()}-01-01`
  const fechaFin    = searchParams.get('fechaFin')    ?? new Date().toISOString().substring(0, 10)
  const advisorId   = searchParams.get('advisorId')   ?? ''
  const tipoFiltro  = (searchParams.get('tipoFiltro') ?? 'all') as TipoFiltro

  const params: any[] = [fechaInicio, fechaFin]
  let idx = 3
  const extraWhere: string[] = []

  if (advisorId) { extraWhere.push(`adv."_id" = $${idx++}`); params.push(advisorId) }

  const typeExtra   = tipoWhereClause(tipoFiltro)
  const whereExtra  = extraWhere.length ? `AND ${extraWhere.join(' AND ')}` : ''

  const sql = `
    WITH classified AS (
      SELECT
        COALESCE(adv."nombreCompleto", c."advisor", 'Sin advisor') AS "advisorNombre",
        adv."_id"                                                   AS "advisorId",
        (${TIPO_INFORME_EXPR})                                      AS "tipoInforme",
        COALESCE(c."inscritos", 0)::int                             AS "inscritos",
        COUNT(DISTINCT CASE
          WHEN (b."asistio" = true OR b."asistencia" = true)
            AND (b."cancelo" IS NULL OR b."cancelo" = false)
          THEN b."_id"
        END)::int AS "asistentes"
      FROM "CALENDARIO" c
      LEFT JOIN "ADVISORS" adv
        ON adv."_id" = c."advisor" OR LOWER(adv."email") = LOWER(c."advisor")
      LEFT JOIN "ACADEMICA_BOOKINGS" b
        ON COALESCE(b."eventoId", b."idEvento") = c."_id"
        AND (b."cancelo" IS NULL OR b."cancelo" = false)
      WHERE c."dia" BETWEEN $1::date AND ($2::date + interval '1 day')
        ${whereExtra}
        ${typeExtra}
      GROUP BY c."_id", adv."nombreCompleto", adv."_id"
    )
    SELECT
      "advisorNombre",
      "advisorId",
      COUNT(*) FILTER (WHERE "tipoInforme" = 'sesiones')::int  AS "totalSesiones",
      COUNT(*) FILTER (WHERE "tipoInforme" = 'jumps')::int     AS "totalJumps",
      COUNT(*) FILTER (WHERE "tipoInforme" = 'training')::int  AS "totalTraining",
      COUNT(*) FILTER (WHERE "tipoInforme" = 'essential')::int AS "totalEssential",
      COUNT(*) FILTER (WHERE "tipoInforme" = 'welcome')::int   AS "totalWelcome",
      COUNT(*)::int                                             AS "totalGeneral",
      SUM("inscritos")::int                                     AS "totalInscritos",
      SUM("asistentes")::int                                    AS "totalAsistentes"
    FROM classified
    WHERE "tipoInforme" IS NOT NULL
    GROUP BY "advisorNombre", "advisorId"
    ORDER BY "totalGeneral" DESC
  `

  const rows = await queryMany<AdvisorRow>(sql, params)

  // ── KPIs totales ─────────────────────────────────────────────────────────
  const kpis = {
    totalSesiones:  rows.reduce((s, r) => s + r.totalSesiones, 0),
    totalJumps:     rows.reduce((s, r) => s + r.totalJumps, 0),
    totalTraining:  rows.reduce((s, r) => s + r.totalTraining, 0),
    totalEssential: rows.reduce((s, r) => s + r.totalEssential, 0),
    totalWelcome:   rows.reduce((s, r) => s + r.totalWelcome, 0),
    totalGeneral:   rows.reduce((s, r) => s + r.totalGeneral, 0),
    totalInscritos: rows.reduce((s, r) => s + r.totalInscritos, 0),
    totalAsistentes: rows.reduce((s, r) => s + r.totalAsistentes, 0),
    pctAsistencia:  safeDiv(
      rows.reduce((s, r) => s + r.totalAsistentes, 0),
      rows.reduce((s, r) => s + r.totalInscritos, 0)
    ),
  }

  // ── Charts ────────────────────────────────────────────────────────────────
  // Stacked bar: one entry per advisor, stacked by type
  const stackedByAdvisor = rows.map(r => ({
    name:      r.advisorNombre.length > 18 ? `${r.advisorNombre.slice(0, 17)}…` : r.advisorNombre,
    fullName:  r.advisorNombre,
    sesiones:  r.totalSesiones,
    jumps:     r.totalJumps,
    training:  r.totalTraining,
    essential: r.totalEssential,
    welcome:   r.totalWelcome,
  }))

  // Donut totals by type (global or per advisor if filtered)
  const donutByType = [
    { name: 'Sesiones',  value: kpis.totalSesiones  },
    { name: 'Jumps',     value: kpis.totalJumps     },
    { name: 'Training',  value: kpis.totalTraining  },
    { name: 'Essential', value: kpis.totalEssential },
    { name: 'Welcome',   value: kpis.totalWelcome   },
  ].filter(d => d.value > 0)

  // Meta dropdowns
  const allAdvisors = await queryMany<{ _id: string; nombreCompleto: string }>(
    `SELECT "_id", "nombreCompleto" FROM "ADVISORS" WHERE "activo" = true ORDER BY "nombreCompleto"`,
    []
  )

  return successResponse({
    kpis,
    charts: { stackedByAdvisor, donutByType },
    table:  rows,
    meta:   { advisors: allAdvisors },
  })
})
