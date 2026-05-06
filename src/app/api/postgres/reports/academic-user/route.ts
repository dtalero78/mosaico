import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { queryMany, queryOne } from '@/lib/postgres'
import { NotFoundError, ValidationError } from '@/lib/errors'

const NIVEL_ORDER = ['ESS','BN1','BN2','BN3','P1','P2','P3','F1','F2','F3']

function safeQ<T>(fn: () => Promise<T>, fb: T): Promise<T> {
  return fn().catch(() => fb)
}

/**
 * GET /api/postgres/reports/academic-user
 * Full academic report for a student: KPIs, weekly distribution,
 * program progress, heatmap, level timing, and booking detail.
 */
export const GET = handlerWithAuth(async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url)
  const numeroId  = searchParams.get('numeroId')?.trim()
  const startDate = searchParams.get('startDate')
  const endDate   = searchParams.get('endDate')
  const nivelFil  = searchParams.get('nivel') || null

  if (!numeroId) throw new ValidationError('numeroId es requerido')

  // ── Resolve student ────────────────────────────────────────────────────
  const academica = await queryOne<any>(
    `SELECT a."_id", a."primerNombre", a."primerApellido", a."nivel", a."step",
            a."numeroId", a."plataforma",
            p."inicioContrato", p."finalContrato", p."contrato"
     FROM "ACADEMICA" a
     LEFT JOIN LATERAL (
       SELECT p2."inicioContrato", p2."finalContrato", p2."contrato"
       FROM "PEOPLE" p2 WHERE p2."numeroId" = a."numeroId"
       ORDER BY CASE WHEN p2."tipoUsuario"='BENEFICIARIO' THEN 0 ELSE 1 END LIMIT 1
     ) p ON true
     WHERE a."numeroId" = $1 LIMIT 1`,
    [numeroId]
  )
  if (!academica) throw new NotFoundError('Estudiante', numeroId)

  const studentId = academica._id
  const nombre = `${academica.primerNombre} ${academica.primerApellido}`

  // ── Build date filters ─────────────────────────────────────────────────
  const conditions: string[] = [
    `(b."idEstudiante" = $1 OR b."studentId" = $1)`,
    `(b."cancelo" IS NULL OR b."cancelo" = false OR b."cancelo" = true)`, // include cancelled for full history
  ]
  const params: any[] = [studentId]
  let idx = 2

  if (startDate) { conditions.push(`b."fechaEvento" >= $${idx}::date`); params.push(startDate); idx++ }
  if (endDate)   { conditions.push(`b."fechaEvento" < ($${idx}::date + INTERVAL '1 day')`); params.push(endDate); idx++ }
  if (nivelFil)  { conditions.push(`COALESCE(c."nivel", b."nivel") = $${idx}`); params.push(nivelFil); idx++ }

  const WHERE = conditions.join(' AND ')

  // ── All bookings (for table + calculations) ────────────────────────────
  const allBookings = await queryMany<any>(
    `SELECT b."_id", b."fechaEvento", b."cancelo",
            COALESCE(c."tipo", b."tipo", b."tipoEvento") AS tipo,
            COALESCE(a2."nombreCompleto", b."advisor") AS advisor,
            COALESCE(c."nivel", b."nivel") AS nivel,
            CASE WHEN COALESCE(c."step", b."step",'') LIKE 'TRAINING%'
              THEN COALESCE(c."nombreEvento", b."nombreEvento", c."step", b."step")
              ELSE COALESCE(c."step", b."step")
            END AS step,
            b."asistio", b."asistencia", b."participacion", b."noAprobo"
     FROM "ACADEMICA_BOOKINGS" b
     LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
     LEFT JOIN "ADVISORS" a2 ON a2."_id" = b."advisor"
     WHERE ${WHERE}
     ORDER BY b."fechaEvento" DESC NULLS LAST`,
    params
  )

  const nonCancelled = allBookings.filter((r: any) => !r.cancelo)
  const attended    = nonCancelled.filter((r: any) => r.asistio || r.asistencia)
  const noAttended  = nonCancelled.filter((r: any) => !r.asistio && !r.asistencia)
  const cancelled   = allBookings.filter((r: any) => r.cancelo)
  const jumpsApproved = nonCancelled.filter((r: any) => {
    const step = (r.step || '')
    const num = parseInt(step.replace(/[^0-9]/g,''))
    return num > 0 && num % 5 === 0 && (r.asistio || r.asistencia) && !r.noAprobo
  })

  // ── KPIs ───────────────────────────────────────────────────────────────
  const kpis = {
    total:          allBookings.length,
    asistidas:      attended.length,
    noAsistidas:    noAttended.length,
    canceladas:     cancelled.length,
    jumpsAprobados: jumpsApproved.length,
  }

  // ── Weekly distribution last 3 months ─────────────────────────────────
  const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const recentBookings = nonCancelled.filter((r: any) =>
    r.fechaEvento && new Date(r.fechaEvento) >= threeMonthsAgo
  )

  // Group by ISO week + nivel
  const weekMap: Record<string, Record<string, number>> = {}
  recentBookings.forEach((r: any) => {
    const d = new Date(r.fechaEvento)
    const week = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,'0')}`
    const nv = r.nivel || 'Sin nivel'
    if (!weekMap[week]) weekMap[week] = {}
    weekMap[week][nv] = (weekMap[week][nv] || 0) + 1
  })
  const distribucionSemanal = Object.entries(weekMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([semana, niveles]) => ({ semana, ...niveles }))

  // ── Program progress ───────────────────────────────────────────────────
  // Get all steps per level from NIVELES
  const nivelesDB = await safeQ(() => queryMany<any>(
    `SELECT "code", "step" FROM "NIVELES" WHERE "code" = ANY($1) ORDER BY "orden" ASC NULLS LAST, "step" ASC`,
    [NIVEL_ORDER]
  ), [])

  const stepsPerNivel: Record<string, string[]> = {}
  nivelesDB.forEach((n: any) => {
    if (!stepsPerNivel[n.code]) stepsPerNivel[n.code] = []
    if (n.step && n.step !== 'WELCOME') stepsPerNivel[n.code].push(n.step)
  })

  // For each nivel, count completed steps from bookings
  const progresaPrograma = NIVEL_ORDER.map(nv => {
    const totalSteps = stepsPerNivel[nv]?.length || 0
    const nivelBookings = nonCancelled.filter((r: any) => r.nivel === nv && (r.asistio || r.asistencia))
    const completedSteps = new Set(nivelBookings.map((r: any) => r.step)).size

    // Time in nivel: first → last booking with attendance
    const nivelDates = nivelBookings
      .map((r: any) => new Date(r.fechaEvento).getTime())
      .filter((t: number) => !isNaN(t))
    const diasEnNivel = nivelDates.length >= 2
      ? Math.ceil((Math.max(...nivelDates) - Math.min(...nivelDates)) / (1000*60*60*24))
      : nivelBookings.length > 0 ? 1 : 0

    const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    return { nivel: nv, totalSteps, completedSteps, diasEnNivel, pct, hasData: nivelBookings.length > 0 }
  })

  // ── Heatmap — bookings grouped by date ─────────────────────────────────
  const heatmapMap: Record<string, number> = {}
  allBookings.forEach((r: any) => {
    if (!r.fechaEvento) return
    const day = new Date(r.fechaEvento).toISOString().split('T')[0]
    heatmapMap[day] = (heatmapMap[day] || 0) + 1
  })
  const heatmap = Object.entries(heatmapMap).map(([date, count]) => ({ date, count }))

  // ── Nivel más agendado & más tiempo ───────────────────────────────────
  const nivelCounts: Record<string, number> = {}
  nonCancelled.forEach((r: any) => {
    const nv = r.nivel || 'Sin nivel'
    nivelCounts[nv] = (nivelCounts[nv] || 0) + 1
  })
  const nivelMasAgendado = Object.entries(nivelCounts).sort(([,a],[,b]) => b-a)[0]?.[0] || '—'
  const nivelMasTiempo = progresaPrograma
    .filter(p => p.hasData)
    .sort((a,b) => b.diasEnNivel - a.diasEnNivel)[0] || null

  return successResponse({
    student: {
      nombre,
      numeroId: academica.numeroId,
      nivel: academica.nivel,
      step: academica.step,
      plataforma: academica.plataforma,
      inicioContrato: academica.inicioContrato,
      finalContrato: academica.finalContrato,
      contrato: academica.contrato,
    },
    kpis,
    distribucionSemanal,
    progresaPrograma,
    heatmap,
    nivelMasAgendado,
    nivelMasTiempo,
    records: allBookings,
    total: allBookings.length,
  })
})

// ISO week number helper
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
