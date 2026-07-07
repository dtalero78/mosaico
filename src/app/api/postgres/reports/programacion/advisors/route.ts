import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany } from '@/lib/postgres'

export type AdvisorReportType = 'sesiones' | 'jumps' | 'training' | 'clubes' | 'welcome' | 'essential'

interface SessionRow {
  _id: string
  dia: string
  horaLocal: string
  nivel: string
  step: string
  nombreEvento: string
  advisorNombre: string
  advisorId: string | null
  capacidad: number
  inscritos: number
  asistentes: number
}

function safeDiv(num: number, den: number) {
  if (den === 0) return 0
  return Math.round((num / den) * 10000) / 100
}

function groupCount(rows: SessionRow[], key: (r: SessionRow) => string) {
  const map: Record<string, { total: number; inscritos: number; asistentes: number }> = {}
  for (const r of rows) {
    const k = key(r) || 'Sin dato'
    if (!map[k]) map[k] = { total: 0, inscritos: 0, asistentes: 0 }
    map[k].total++
    map[k].inscritos  += r.inscritos
    map[k].asistentes += r.asistentes
  }
  return Object.entries(map).map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
}

/** Extract "LISTENING" from "LISTENING - Step 7" */
function extractClubType(nombreEvento: string): string {
  const n = nombreEvento?.trim() ?? ''
  return n.includes(' - ') ? n.split(' - ')[0].trim() : n || 'Sin tipo'
}

function buildHeatmap(rows: SessionRow[]) {
  const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (!r.horaLocal || r.horaLocal < '06:00' || r.horaLocal > '22:00') continue
    const d   = new Date(r.dia)
    const day = DAYS[d.getUTCDay()]
    const k   = `${day}|${r.horaLocal}`
    map[k] = (map[k] ?? 0) + 1
  }
  return Object.entries(map).map(([k, total]) => {
    const [dia, hora] = k.split('|')
    return { dia, hora, total }
  })
}

function buildTypeCondition(reportType: AdvisorReportType): string {
  switch (reportType) {
    case 'sesiones':
      return `c."tipo" = 'SESSION'
        AND c."nivel" IS DISTINCT FROM 'WELCOME'
        AND COALESCE(c."tituloONivel",'') NOT ILIKE '%WELCOME%'
        AND COALESCE(c."nombreEvento",'')  NOT ILIKE '%WELCOME%'
        AND (
          c."step" IS NULL
          OR NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'') IS NULL
          OR NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int % 5 != 0
        )`
    case 'jumps':
      return `c."tipo" = 'SESSION'
        AND c."nivel" IS DISTINCT FROM 'WELCOME'
        AND COALESCE(c."tituloONivel",'') NOT ILIKE '%WELCOME%'
        AND c."step" IS NOT NULL
        AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'') IS NOT NULL
        AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int > 0
        AND NULLIF(REGEXP_REPLACE(c."step",'[^0-9]','','g'),'')::int % 5 = 0`
    case 'training':
      return `c."tipo" = 'CLUB'
        AND COALESCE(c."nombreEvento", c."tituloONivel",'') ILIKE 'TRAINING -%'`
    case 'clubes':
      return `c."tipo" = 'CLUB'
        AND COALESCE(c."nombreEvento", c."tituloONivel",'') NOT ILIKE 'TRAINING -%'
        AND COALESCE(c."tituloONivel",'') NOT ILIKE '%WELCOME%'
        AND COALESCE(c."nombreEvento",'')  NOT ILIKE '%WELCOME%'`
    case 'welcome':
      return `(c."nivel" = 'WELCOME'
        OR c."tituloONivel" ILIKE '%WELCOME%'
        OR c."nombreEvento" ILIKE '%WELCOME%'
        OR c."tipo" = 'WELCOME')`
    case 'essential':
      return `c."tipo" = 'SESSION' AND c."nivel" = 'ESS'`
    default:
      return 'false'
  }
}

export const GET = handlerWithAuth(async (req, _ctx, _session) => {
  const { searchParams } = new URL(req.url)
  const reportType  = (searchParams.get('reportType') ?? 'sesiones') as AdvisorReportType
  const fechaInicio = searchParams.get('fechaInicio') ?? `${new Date().getFullYear()}-01-01`
  const fechaFin    = searchParams.get('fechaFin')    ?? new Date().toISOString().substring(0, 10)
  const advisorId   = searchParams.get('advisorId')   ?? ''
  const nivel       = searchParams.get('nivel')       ?? ''
  const tipoClub    = searchParams.get('tipoClub')    ?? ''
  const rawTz       = searchParams.get('tz')          ?? 'UTC'
  const tz          = /^[A-Za-z_/+-]+$/.test(rawTz) && rawTz.length < 64 ? rawTz : 'UTC'

  const typeCondition = buildTypeCondition(reportType)
  const params: any[] = [fechaInicio, fechaFin, tz]
  let idx = 4
  const extraWhere: string[] = []

  if (advisorId) { extraWhere.push(`adv."_id" = $${idx++}`); params.push(advisorId) }
  if (nivel && reportType !== 'clubes' && reportType !== 'welcome') {
    extraWhere.push(`c."nivel" = $${idx++}`); params.push(nivel)
  }
  // For clubes: filter by extracted club type
  if (tipoClub && reportType === 'clubes') {
    extraWhere.push(`COALESCE(c."nombreEvento", c."tituloONivel",'') ILIKE $${idx++}`)
    params.push(`${tipoClub} -%`)
  }

  const whereExtra = extraWhere.length ? `AND ${extraWhere.join(' AND ')}` : ''

  const sql = `
    SELECT
      c."_id",
      c."dia",
      TO_CHAR(c."dia" AT TIME ZONE $3, 'HH24:MI')              AS "horaLocal",
      COALESCE(c."nivel", '')                                    AS "nivel",
      COALESCE(c."step", '')                                     AS "step",
      COALESCE(c."nombreEvento", c."tituloONivel", '')           AS "nombreEvento",
      COALESCE(adv."nombreCompleto", c."advisor", 'Sin advisor') AS "advisorNombre",
      adv."_id"                                                  AS "advisorId",
      COALESCE(c."limiteUsuarios", 0)::int                       AS "capacidad",
      COALESCE(c."inscritos", 0)::int                            AS "inscritos",
      COUNT(DISTINCT CASE
        WHEN (b."asistio" = true OR b."asistencia" = true)
          AND (b."cancelo" IS NULL OR b."cancelo" = false)
        THEN b."_id"
      END)::int AS "asistentes"
    FROM "CALENDARIO" c
    LEFT JOIN "GUIAS" adv
      ON adv."_id" = c."advisor" OR LOWER(adv."email") = LOWER(c."advisor")
    LEFT JOIN "ACADEMICA_BOOKINGS" b
      ON COALESCE(b."eventoId", b."idEvento") = c."_id"
      AND (b."cancelo" IS NULL OR b."cancelo" = false)
      AND NOT EXISTS (
        SELECT 1 FROM "PEOPLE" pp_prb
        WHERE pp_prb."numeroId" = b."numeroId"
          AND COALESCE(pp_prb."contrato",'') LIKE 'PRB-%'
      )
    WHERE c."dia" BETWEEN $1::date AND ($2::date + interval '1 day')
      AND ${typeCondition}
      ${whereExtra}
    GROUP BY c."_id", adv."nombreCompleto", adv."_id"
    ORDER BY c."dia" ASC, c."hora" ASC
  `

  const rows = await queryMany<SessionRow>(sql, params)

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const totalInscritos    = rows.reduce((s, r) => s + r.inscritos, 0)
  const totalAsistentes   = rows.reduce((s, r) => s + r.asistentes, 0)
  const totalNoAsistieron = Math.max(0, totalInscritos - totalAsistentes)

  const advisorIds = [...new Set(rows.map(r => r.advisorId).filter(Boolean))]
  let totalAdvisorsActivos = advisorIds.length
  if (advisorIds.length > 0) {
    const activeRows = await queryMany<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "GUIAS" WHERE "_id" = ANY($1) AND "activo" = true`,
      [advisorIds]
    )
    totalAdvisorsActivos = parseInt(activeRows[0]?.count ?? '0', 10)
  }

  const kpis = {
    totalSesiones:          rows.length,
    totalAdvisors:          totalAdvisorsActivos,
    totalAgendados:         totalInscritos,
    totalAsistieron:        totalAsistentes,
    totalNoAsistieron,
    porcentajeAsistencia:   safeDiv(totalAsistentes, totalInscritos),
    porcentajeInasistencia: safeDiv(totalNoAsistieron, totalInscritos),
  }

  // ── Grouping key: nivel for most, club type for clubes ────────────────────
  const secundarioKey = reportType === 'clubes'
    ? (r: SessionRow) => extractClubType(r.nombreEvento)
    : (r: SessionRow) => r.nivel || 'Sin nivel'

  const byAdvisor    = groupCount(rows, r => r.advisorNombre)
  const bySecundario = groupCount(rows, secundarioKey)

  const ranking = advisorId
    ? bySecundario.map((item, i) => ({
        posicion: i + 1, nombre: item.name,
        totalSesiones: item.total, totalAgendados: item.inscritos,
        totalAsistieron: item.asistentes,
        totalNoAsistieron: Math.max(0, item.inscritos - item.asistentes),
        pctAsistencia: safeDiv(item.asistentes, item.inscritos),
      }))
    : byAdvisor.map((item, i) => ({
        posicion: i + 1, nombre: item.name,
        totalSesiones: item.total, totalAgendados: item.inscritos,
        totalAsistieron: item.asistentes,
        totalNoAsistieron: Math.max(0, item.inscritos - item.asistentes),
        pctAsistencia: safeDiv(item.asistentes, item.inscritos),
      }))

  const charts = {
    sesionesPorAdvisor:     byAdvisor.map(a => ({ name: a.name, total: a.total })),
    sesionesPorNivel:       bySecundario.map(n => ({ name: n.name, total: n.total })),
    asistenciaPorAdvisor:   byAdvisor.map(a => ({
      name: a.name, asistieron: a.asistentes,
      noAsistieron: Math.max(0, a.inscritos - a.asistentes),
    })),
    asistenciaPorNivel:     bySecundario.map(n => ({
      name: n.name, asistieron: n.asistentes,
      noAsistieron: Math.max(0, n.inscritos - n.asistentes),
    })),
    distribucionPorNivel:   bySecundario.map(n => ({ name: n.name, total: n.total })),
    heatmapDiaHora:         buildHeatmap(rows),
  }

  const table = rows.map(r => ({
    _id: r._id,
    fecha: r.dia.toString().substring(0, 10),
    hora: r.horaLocal,
    nivel: r.nivel,
    step: r.step,
    nombreEvento: r.nombreEvento,
    tipoClub: reportType === 'clubes' ? extractClubType(r.nombreEvento) : null,
    advisorNombre: r.advisorNombre,
    capacidad: r.capacidad,
    inscritos: r.inscritos,
    asistentes: r.asistentes,
    noAsistieron: Math.max(0, r.inscritos - r.asistentes),
    pctAsistencia: safeDiv(r.asistentes, r.inscritos),
  }))

  // Meta dropdowns
  const allAdvisors = await queryMany<{ _id: string; nombreCompleto: string }>(
    `SELECT "_id", "nombreCompleto" FROM "GUIAS" WHERE "activo" = true ORDER BY "nombreCompleto"`,
    []
  )

  // For clubes: distinct club types; for others: distinct niveles
  const secundarioValues = reportType === 'clubes'
    ? [...new Set(rows.map(r => extractClubType(r.nombreEvento)).filter(Boolean))].sort()
    : [...new Set(rows.map(r => r.nivel).filter(Boolean))].sort()

  return successResponse({
    kpis, ranking, charts, table,
    meta: { advisors: allAdvisors, niveles: secundarioValues, reportType },
  })
})
