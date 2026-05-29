import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { getLastRun, isStale } from '@/lib/cron-runs'
import { InformesPermission } from '@/types/permissions'
import { findPegados } from '@/services/usuarios-pegados.service'

/**
 * GET /api/postgres/reports/academica/conciliacion-steps?startDate&endDate
 *
 * Monitoreo del cron reconcile-pegados (02:00 UTC = 9 PM Colombia):
 *
 *   El cron reconcilia "usuarios pegados" LIMPIOS (sin overrides ni
 *   clrHistoric) alineando ACADEMICA.step al step real calculado desde sus
 *   bookings. Los casos con flags (overrides activos, clrHistoric) NO se
 *   tocan automáticamente — quedan listados acá para decisión manual.
 *
 * Devuelve:
 *   - Salud del cron (última corrida desde CRON_RUNS, stale flag).
 *   - Pegados LIMPIOS pendientes (deberían ser 0 si el cron está al día).
 *   - Pegados CON FLAGS (overrides o clrHistoric) — requieren admin.
 *   - Reconciliaciones del rango (acciones del cron en las fechas pedidas).
 *
 * Gateado por INFORMES.ACADEMICA.CONCILIACION_STEPS (SUPER_ADMIN/ADMIN bypass).
 */

interface CronDetail {
  studentId: string; nombre: string; numeroId?: string; nivel?: string;
  stepAnterior?: number; stepNuevo?: number;
  status?: string; success: boolean; error?: string;
}

export const GET = handlerWithAuth(async (req, _ctx, session) => {
  await requirePermission(session, InformesPermission.ACAD_CONCILIACION_STEPS)

  const { searchParams } = new URL(req.url)
  const end   = searchParams.get('endDate')   || new Date().toISOString().substring(0, 10)
  const start = searchParams.get('startDate') || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10) })()

  // ── Salud del cron ──
  const reconLast = await getLastRun('reconcile-pegados')
  const fin = reconLast?.finishedAt ? new Date(reconLast.finishedAt) : null
  const hrs = fin ? +((Date.now() - fin.getTime()) / 3_600_000).toFixed(1) : null
  const cron = {
    lastRun: fin?.toISOString() ?? null,
    status:  reconLast?.status ?? null,
    hoursSince: hrs,
    stale: isStale(reconLast),
    processed: reconLast?.processedCount ?? 0,
    success:   reconLast?.successCount   ?? 0,
    failed:    reconLast?.failedCount    ?? 0,
    error:     reconLast?.errorMessage ?? null,
    // metadata extra del job (totalPegados, omitidos, breakdown)
    metadata:  reconLast?.metadata ?? null,
  }

  // ── Pegados AHORA (limpios + con flags) ──
  let pegadosLimpios: any[] = []
  let pegadosConFlags: any[] = []
  let calculatedAt: string | null = null
  let pegadosCached = false
  try {
    const pegados = await findPegados()
    calculatedAt = pegados.calculatedAt
    pegadosCached = pegados.cached
    const reconLastDate = fin ? fin.toISOString().substring(0, 10) : null
    const causaLimpio = (): string => {
      if (cron.stale) return 'El cron no se ha ejecutado en >26h (revisar cron-worker en DO)'
      if (!reconLastDate) return 'El cron aún no ha corrido por primera vez'
      return 'Pendiente para la próxima ejecución (emergió tras la última corrida)'
    }
    for (const r of pegados.rows) {
      const baseRow = {
        _id: r.academicaId, nombre: r.nombre, numeroId: r.numeroId,
        plataforma: r.plataforma, contrato: r.contrato, nivel: r.nivel,
        stepActual: r.stepActual, stepReal: r.stepReal, desfase: r.desfase,
        totalBookings: r.totalBookings,
        clrHistoric: r.clrHistoric, overridesCount: r.overridesCount,
        overrideDetails: r.overrideDetails,
      }
      if (!r.clrHistoric && r.overridesCount === 0) {
        pegadosLimpios.push({ ...baseRow, causa: causaLimpio() })
      } else {
        const banderas: string[] = []
        if (r.clrHistoric) banderas.push('Clear Historic')
        if (r.overridesCount > 0) banderas.push(`${r.overridesCount} override${r.overridesCount === 1 ? '' : 's'}`)
        pegadosConFlags.push({ ...baseRow, banderas: banderas.join(' · ') })
      }
    }
  } catch (e: any) {
    console.warn('[conciliacion-steps] findPegados falló:', e?.message)
  }

  // ── Reconciliaciones del cron en el rango ──
  const runsRange = await query<any>(`
    SELECT "startedAt", "metadata"
    FROM "CRON_RUNS"
    WHERE "cronName" = 'reconcile-pegados'
      AND "startedAt" >= $1::date AND "startedAt" < ($2::date + interval '1 day')
    ORDER BY "startedAt" DESC`, [start, end]).catch(() => ({ rows: [] }))
  const reconciliaciones: any[] = []
  for (const r of runsRange.rows) {
    const fecha = new Date(r.startedAt).toISOString().substring(0, 10)
    const details: CronDetail[] = r.metadata?.details ?? []
    for (const d of details) {
      reconciliaciones.push({
        fecha, nombre: d.nombre, studentId: d.studentId, numeroId: d.numeroId,
        nivel: d.nivel, stepAnterior: d.stepAnterior, stepNuevo: d.stepNuevo,
        status: d.status, success: d.success, error: d.error,
      })
    }
  }
  const recOk = reconciliaciones.filter(r => r.success).length
  const recFail = reconciliaciones.filter(r => !r.success).length

  return successResponse({
    cron,
    rango: { startDate: start, endDate: end },
    snapshot: { calculatedAt, cached: pegadosCached, totalPegados: pegadosLimpios.length + pegadosConFlags.length },
    pegadosLimpios, pegadosConFlags,
    reconciliaciones,
    totalesRango: { reconciliacionesOk: recOk, reconciliacionesFail: recFail },
  })
})
