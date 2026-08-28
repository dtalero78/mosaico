import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ForbiddenError } from '@/lib/errors'
import { queryOne } from '@/lib/postgres'
import { getLastRun, isStale } from '@/lib/cron-runs'

/**
 * GET /api/cron/health-check
 *
 * Estado de los cron jobs registrados en CRON_RUNS. Detecta proactivamente
 * si un cron lleva tiempo sin ejecutarse (worker en DO caído, secret mal
 * configurado, etc.) sin tener que entrar a los logs del panel.
 *
 * Para cada cron:
 *   - lastRun: timestamp de la última ejecución terminada
 *   - lastStatus: 'success' | 'partial' | 'error'
 *   - hoursSinceLastRun: cuántas horas desde la última ejecución
 *   - stale: true si han pasado >26h (los crones son diarios + 2h margen)
 *   - lastProcessed/Success/Failed: counts de la última corrida
 *   - pendingNow: cuántos casos hay AHORA esperando ser procesados
 *     (si el cron corrió bien pero igual hay pendientes, algo más anda mal)
 *
 * Acceso: SUPER_ADMIN y ADMIN (info operativa, no leak sensible pero mejor
 * proteger). Bookmark sugerido para revisión periódica.
 */
export const GET = handlerWithAuth(async (_request, _ctx, session) => {
  const role = (session?.user as any)?.role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    throw new ForbiddenError('Sólo SUPER_ADMIN/ADMIN puede consultar el health-check')
  }

  const reactivateLast = await getLastRun('reactivate-onhold')
  const expireLast     = await getLastRun('expire-contracts')
  const nivelLast      = await getLastRun('cancelar-nivelaciones-sin-confirmar')

  const reactivatePending = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "PEOPLE"
     WHERE "estadoInactivo" = true
       AND "fechaFinOnHold" IS NOT NULL
       AND "fechaFinOnHold"::date <= CURRENT_DATE`,
  ).catch(() => null)

  // Para expire-contracts no contamos pendientes (la query depende del helper
  // contract-expiry y es más cara); se puede agregar después si se necesita.

  return successResponse({
    now: new Date().toISOString(),
    crons: {
      'reactivate-onhold': summarize(reactivateLast, reactivatePending?.n ?? null),
      'expire-contracts':  summarize(expireLast, null),
      // Semanal (jueves 22:00 de Chile): con el umbral diario saldría "stale"
      // seis días de cada siete, así que se le da su propia ventana.
      'cancelar-nivelaciones-sin-confirmar': summarize(nivelLast, null, 8 * 24 + 2),
    },
  })
})

function summarize(run: any, pendingNow: number | null, maxHours?: number) {
  if (!run) {
    return {
      lastRun: null,
      lastStatus: null,
      hoursSinceLastRun: null,
      stale: true,
      lastProcessed: 0,
      lastSuccess: 0,
      lastFailed: 0,
      pendingNow,
      message: 'Sin registros de ejecución. ¿El cron-worker está desplegado?',
    }
  }
  const finishedAt = run.finishedAt ? new Date(run.finishedAt) : null
  const ageMs = finishedAt ? Date.now() - finishedAt.getTime() : null
  const hours = ageMs !== null ? +(ageMs / 3_600_000).toFixed(1) : null
  return {
    lastRun: finishedAt?.toISOString() ?? null,
    lastStatus: run.status,
    hoursSinceLastRun: hours,
    stale: maxHours ? isStale(run, maxHours) : isStale(run),
    lastProcessed: run.processedCount ?? 0,
    lastSuccess: run.successCount ?? 0,
    lastFailed: run.failedCount ?? 0,
    lastError: run.errorMessage ?? null,
    pendingNow,
  }
}
