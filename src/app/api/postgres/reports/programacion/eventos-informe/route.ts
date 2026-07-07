import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany } from '@/lib/postgres'

// ── Raw row returned from SQL ────────────────────────────────────────────────
interface EventRow {
  _id: string
  dia: string
  hora: string | null        // raw UTC (legacy Wix) or Colombia (POSTGRES) — use horaLocal
  horaLocal: string          // always Colombia time derived from dia AT TIME ZONE 'America/Bogota'
  tipo: string
  nivel: string | null
  step: string | null
  nombreEvento: string | null
  advisorNombre: string
  capacidad: number
  inscritos: number
  asistentes: number
  tipoDerivado: string   // SESSION | JUMP | TRAINING | CLUB | WELCOME
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function safeDiv(num: number, den: number) {
  if (den === 0) return 0
  return Math.round((num / den) * 10000) / 100  // 2 decimals
}

function buildTypeCondition(reportType: string): string {
  switch (reportType) {
    case 'sessions-jumps':
      return `(c."tipo" = 'SESSION'
        AND c."nivel" IS DISTINCT FROM 'WELCOME'
        AND COALESCE(c."tituloONivel",'') NOT ILIKE '%WELCOME%'
        AND COALESCE(c."nombreEvento",'') NOT ILIKE '%WELCOME%')`
    case 'training-clubs':
      return `(c."tipo" = 'CLUB'
        AND COALESCE(c."tituloONivel",'') NOT ILIKE '%WELCOME%'
        AND COALESCE(c."nombreEvento",'') NOT ILIKE '%WELCOME%')`
    case 'welcome':
      return `(c."tituloONivel" ILIKE '%WELCOME%'
        OR c."nombreEvento" ILIKE '%WELCOME%'
        OR c."nivel" = 'WELCOME'
        OR c."tipo" = 'WELCOME')`
    default:
      return 'false'
  }
}

function derivedTypeExpr(): string {
  return `
    CASE
      WHEN c."tituloONivel" ILIKE '%WELCOME%'
        OR c."nombreEvento"  ILIKE '%WELCOME%'
        OR c."nivel" = 'WELCOME'
        OR c."tipo"  = 'WELCOME'
        THEN 'WELCOME'
      WHEN c."tipo" = 'CLUB'
        AND COALESCE(c."nombreEvento", c."tituloONivel", '') ILIKE 'TRAINING -%'
        THEN 'TRAINING'
      WHEN c."tipo" = 'CLUB'
        THEN 'CLUB'
      WHEN c."tipo" = 'SESSION'
        AND c."step" IS NOT NULL
        AND NULLIF(REGEXP_REPLACE(c."step", '[^0-9]', '', 'g'), '') IS NOT NULL
        AND NULLIF(REGEXP_REPLACE(c."step", '[^0-9]', '', 'g'), '')::int > 0
        AND NULLIF(REGEXP_REPLACE(c."step", '[^0-9]', '', 'g'), '')::int % 5 = 0
        THEN 'JUMP'
      ELSE 'SESSION'
    END
  `
}

// ── Chart helpers ────────────────────────────────────────────────────────────
function groupBy<K extends string>(rows: EventRow[], key: (r: EventRow) => K) {
  const map: Record<string, number> = {}
  for (const r of rows) {
    const k = key(r) || 'Sin dato'
    map[k] = (map[k] ?? 0) + 1
  }
  return Object.entries(map).map(([k, total]) => ({ name: k, total }))
    .sort((a, b) => b.total - a.total)
}

// Club type breakdown: extracts sub-type from nombreEvento ("LISTENING - Step 7" → "LISTENING")
function buildClubsPorTipo(rows: EventRow[]) {
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (r.tipoDerivado !== 'CLUB') continue
    const nombre = r.nombreEvento?.trim() ?? ''
    const tipo = nombre.includes(' - ')
      ? nombre.split(' - ')[0].trim()
      : nombre || 'Sin tipo'
    map[tipo] = (map[tipo] ?? 0) + 1
  }
  return Object.entries(map).map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
}

// Hours: uses horaLocal (client tz from dia), chronological, 06:00–22:00
function buildHoraChart(rows: EventRow[]) {
  const map: Record<string, number> = {}
  for (const r of rows) {
    const h = r.horaLocal
    if (!h || h < '06:00' || h > '22:00') continue
    map[h] = (map[h] ?? 0) + 1
  }
  return Object.entries(map).map(([name, total]) => ({ name, total }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildHeatmap(rows: EventRow[]) {
  const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const map: Record<string, number> = {}
  for (const r of rows) {
    const h = r.horaLocal
    if (!h || h < '06:00' || h > '22:00') continue
    const d = new Date(r.dia)
    const day = DAYS[d.getUTCDay()]
    const k = `${day}|${h}`
    map[k] = (map[k] ?? 0) + 1
  }
  return Object.entries(map).map(([k, total]) => {
    const [dia, hora] = k.split('|')
    return { dia, hora, total }
  })
}

function buildTimeSeries(rows: EventRow[]) {
  const map: Record<string, { inscritos: number; asistentes: number }> = {}
  for (const r of rows) {
    const fecha = r.dia.toString().substring(0, 10)
    if (!map[fecha]) map[fecha] = { inscritos: 0, asistentes: 0 }
    map[fecha].inscritos  += r.inscritos
    map[fecha].asistentes += r.asistentes
  }
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, v]) => ({ fecha, ...v }))
}

// ── Route ────────────────────────────────────────────────────────────────────
export const GET = handlerWithAuth(async (req, _ctx, _session) => {
  const { searchParams } = new URL(req.url)
  const reportType    = searchParams.get('reportType') ?? 'sessions-jumps'
  const fechaInicio   = searchParams.get('fechaInicio') ?? `${new Date().getFullYear()}-01-01`
  const fechaFin      = searchParams.get('fechaFin')    ?? new Date().toISOString().substring(0, 10)
  const nivel         = searchParams.get('nivel')         ?? ''
  const hora          = searchParams.get('hora')          ?? ''
  const advisorNombre = searchParams.get('advisorNombre') ?? ''
  const tipoClub      = searchParams.get('tipoClub')      ?? ''

  // Validate timezone — IANA format (e.g. America/Bogota) or UTC
  const rawTz = searchParams.get('tz') ?? 'UTC'
  const tz = /^[A-Za-z_/+-]+$/.test(rawTz) && rawTz.length < 64 ? rawTz : 'UTC'

  const typeCondition = buildTypeCondition(reportType)
  // $1=fechaInicio, $2=fechaFin, $3=tz — filters start at $4
  const params: any[] = [fechaInicio, fechaFin, tz]
  let idx = 4
  const extraWhere: string[] = []

  if (nivel)         { extraWhere.push(`c."nivel" = $${idx++}`);                                    params.push(nivel) }
  if (hora)          { extraWhere.push(`TO_CHAR(c."dia" AT TIME ZONE $3, 'HH24:MI') LIKE $${idx++}`); params.push(`${hora}%`) }
  if (advisorNombre) { extraWhere.push(`COALESCE(adv."nombreCompleto", c."advisor", '') ILIKE $${idx++}`); params.push(`%${advisorNombre}%`) }
  if (tipoClub)      { extraWhere.push(`COALESCE(c."nombreEvento", c."tituloONivel", '') ILIKE $${idx++}`); params.push(`%${tipoClub}%`) }

  const whereExtra = extraWhere.length > 0 ? `AND ${extraWhere.join(' AND ')}` : ''

  const sql = `
    SELECT
      c."_id",
      c."dia",
      c."hora",
      TO_CHAR(c."dia" AT TIME ZONE $3, 'HH24:MI') AS "horaLocal",
      c."tipo",
      COALESCE(c."nivel", '') AS "nivel",
      COALESCE(c."step",  '') AS "step",
      COALESCE(c."nombreEvento", c."tituloONivel", '') AS "nombreEvento",
      COALESCE(adv."nombreCompleto", c."advisor", 'Sin advisor') AS "advisorNombre",
      COALESCE(c."limiteUsuarios", 0)::int AS "capacidad",
      COALESCE(c."inscritos", 0)::int      AS "inscritos",
      COUNT(DISTINCT CASE
        WHEN (b."asistio" = true OR b."asistencia" = true)
          AND (b."cancelo" IS NULL OR b."cancelo" = false)
        THEN b."_id"
      END)::int AS "asistentes",
      (${derivedTypeExpr()}) AS "tipoDerivado"
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
    GROUP BY c."_id", adv."nombreCompleto"
    ORDER BY c."dia" ASC, c."hora" ASC
  `

  const rows = await queryMany<EventRow>(sql, params)

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalInscritos  = rows.reduce((s, r) => s + r.inscritos, 0)
  const totalAsistentes = rows.reduce((s, r) => s + r.asistentes, 0)
  const totalCapacidad  = rows.reduce((s, r) => s + r.capacidad, 0)
  const totalPorTipo: Record<string, number> = {}
  for (const r of rows) {
    totalPorTipo[r.tipoDerivado] = (totalPorTipo[r.tipoDerivado] ?? 0) + 1
  }

  const kpis = {
    totalEventos:  rows.length,
    totalPorTipo,
    totalInscritos,
    totalAsistentes,
    totalCapacidad,
    pctAsistencia: safeDiv(totalAsistentes, totalInscritos),
    pctOcupacion:  safeDiv(totalInscritos,  totalCapacidad),
  }

  // ── Charts ────────────────────────────────────────────────────────────────
  const charts: Record<string, unknown> = {
    eventosPorTipo:        groupBy(rows, r => r.tipoDerivado),
    clubsPorTipo:          buildClubsPorTipo(rows),
    eventosPorNivel:       groupBy(rows, r => r.nivel || 'Sin nivel'),
    eventosPorHora:        buildHoraChart(rows),
    asistenciaVsInscritos: buildTimeSeries(rows),
    rankingAdvisors:       groupBy(rows, r => r.advisorNombre),
    heatmapDiaHora:        buildHeatmap(rows),
  }

  // Split SESSION vs JUMP for sessions-jumps report
  if (reportType === 'sessions-jumps') {
    const sRows = rows.filter(r => r.tipoDerivado === 'SESSION')
    const jRows = rows.filter(r => r.tipoDerivado === 'JUMP')
    charts.sessionsPorNivel        = groupBy(sRows, r => r.nivel || 'Sin nivel')
    charts.sessionsPorHora         = buildHoraChart(sRows)
    charts.sesionesAsistencia      = buildTimeSeries(sRows)
    charts.jumpsPorNivel           = groupBy(jRows, r => r.nivel || 'Sin nivel')
    charts.jumpsPorHora            = buildHoraChart(jRows)
    charts.jumpsAsistencia         = buildTimeSeries(jRows)
    charts.rankingAdvisorsSesiones = groupBy(sRows, r => r.advisorNombre)
    charts.rankingAdvisorsJumps    = groupBy(jRows, r => r.advisorNombre)
    charts.heatmapSesiones         = buildHeatmap(sRows)
    charts.heatmapJumps            = buildHeatmap(jRows)
  }

  // Split TRAINING vs CLUB for training-clubs report
  if (reportType === 'training-clubs') {
    const tRows = rows.filter(r => r.tipoDerivado === 'TRAINING')
    const cRows = rows.filter(r => r.tipoDerivado === 'CLUB')
    charts.trainingPorNivel        = groupBy(tRows, r => r.nivel || 'Sin nivel')
    charts.trainingPorHora         = buildHoraChart(tRows)
    charts.trainingAsistencia      = buildTimeSeries(tRows)
    charts.clubesPorNivel          = groupBy(cRows, r => r.nivel || 'Sin nivel')
    charts.clubesPorHora           = buildHoraChart(cRows)
    charts.clubesAsistencia        = buildTimeSeries(cRows)
    charts.rankingAdvisorsTraining = groupBy(tRows, r => r.advisorNombre)
    charts.rankingAdvisorsClub     = groupBy(cRows, r => r.advisorNombre)
    charts.heatmapTraining         = buildHeatmap(tRows)
    charts.heatmapClub             = buildHeatmap(cRows)
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const table = rows.map(r => ({
    ...r,
    dia:          r.dia.toString().substring(0, 10),
    hora:         r.horaLocal,   // show client-tz time in table, not raw UTC
    pctAsistencia: safeDiv(r.asistentes, r.inscritos),
    pctOcupacion:  safeDiv(r.inscritos,  r.capacidad),
  }))

  // Distinct values for filter dropdowns — use horaLocal (06:00–22:00)
  const niveles  = [...new Set(rows.map(r => r.nivel).filter(Boolean))].sort()
  const horas    = [...new Set(
    rows.map(r => r.horaLocal).filter(h => h && h >= '06:00' && h <= '22:00')
  )].sort()
  const advisors = [...new Set(rows.map(r => r.advisorNombre).filter(v => v !== 'Sin advisor'))].sort()

  return successResponse({ kpis, charts, table, meta: { niveles, horas, advisors } })
})
