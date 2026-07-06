import { NextRequest, NextResponse } from 'next/server'
import { findPegados, aplicarReconciliacion } from '@/services/usuarios-pegados.service'
import { recordCronRun } from '@/lib/cron-runs'

const CRON_SECRET = process.env.CRON_SECRET

// Máximo de pegados a reconciliar por corrida. Coincide con MAX_BULK_SIZE
// del service. Si hay más casos limpios pendientes, el resto queda para la
// próxima corrida (queda registrado en metadata.omitidos).
const MAX_PER_RUN = 100

/**
 * Cron Job: Reconciliación nocturna de "usuarios pegados"
 *
 * Llamado por cron-worker (Node.js daemon en Digital Ocean) a las 02:00 UTC
 * todos los días con Authorization: Bearer <CRON_SECRET>.
 *
 * Procesa SOLO los casos "limpios" (sin clrHistoric, sin overrides) — son
 * los que la herramienta /admin/scripts/usuarios-pegados ya marca como
 * seguros para reconciliación automática. Los casos con flags
 * (overrides, clrHistoric) NO se tocan: requieren decisión manual y se
 * dejan listados como inconsistencias en el informe Hold & Vigencias.
 *
 * Cada ejecución queda registrada en CRON_RUNS via recordCronRun() — el
 * informe Hold & Vigencias muestra la salud + las acciones del rango.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    console.log('Cron reconcile-pegados: Unauthorized request')
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recordCronRun('reconcile-pegados', async () => {
      console.log('Cron reconcile-pegados: Iniciando reconciliación nocturna')

      // 1) Detectar todos los pegados — force=true salta el caché de 30 min
      const pegados = await findPegados({ force: true })
      const total = pegados.rows.length

      // 2) Filtrar SOLO casos limpios — sin overrides activos ni clrHistoric.
      //    Los con flags quedan listados en Hold & Vigencias para revisión manual.
      const limpios = pegados.rows.filter(r => !r.clrHistoric && r.overridesCount === 0)
      const conFlags = total - limpios.length
      console.log(`Cron reconcile-pegados: ${total} pegados | ${limpios.length} limpios | ${conFlags} con flags (saltados)`)

      if (!limpios.length) {
        return {
          processedCount: 0,
          successCount: 0,
          failedCount: 0,
          metadata: { totalPegados: total, limpios: 0, conFlags, omitidos: 0, details: [] },
        }
      }

      // 3) Tomar hasta MAX_PER_RUN. El resto queda para la próxima noche.
      const toReconcile = limpios.slice(0, MAX_PER_RUN)
      const omitidos = limpios.length - toReconcile.length

      // 4) Ejecutar la reconciliación (idempotente: si alguien ya lo movió
      //    entre la detección y este step, el service devuelve already_synced).
      const results = await aplicarReconciliacion({
        academicaIds: toReconcile.map(r => r.academicaId),
        motivo: '[Cron] Reconciliación nocturna automática (caso limpio, sin flags)',
        realizadoPor: 'cron@lgs-plataforma.com',
        realizadoPorNombre: 'Cron Reconciliación',
      })

      const succ = results.filter(r => r.status === 'ok').length
      const noOp = results.filter(r => r.status === 'already_synced' || r.status === 'no_change_needed').length
      const blocked = results.filter(r => r.status === 'blocked_by_override').length
      const failed = results.filter(r => r.status === 'error').length

      // 5) Detalles auditables (con nombre + niveles)
      const idToInfo = new Map(toReconcile.map(r => [r.academicaId, r]))
      const details = results.map(r => {
        const info = idToInfo.get(r.academicaId)
        return {
          studentId: r.academicaId,
          nombre: info?.nombre ?? '',
          numeroId: info?.numeroId ?? '',
          nivel: info?.nivel ?? '',
          stepAnterior: info?.stepActual,
          stepNuevo: info?.stepReal,
          status: r.status,
          success: r.status === 'ok' || r.status === 'already_synced' || r.status === 'no_change_needed',
          error: r.error,
        }
      })

      console.log(`Cron reconcile-pegados: OK=${succ} | no-op=${noOp} | blocked=${blocked} | failed=${failed} | omitidos=${omitidos}`)

      return {
        processedCount: results.length,
        successCount: succ + noOp,
        failedCount: failed + blocked,
        metadata: {
          totalPegados: total,
          limpios: limpios.length,
          conFlags,
          omitidos,
          breakdown: { ok: succ, alreadySynced: noOp, blockedByOverride: blocked, errors: failed },
          details,
        },
      }
    })

    return NextResponse.json({
      success: true,
      message: `Reconciliación nocturna: ${result.successCount}/${result.processedCount} OK`,
      processed: result.processedCount,
      successful: result.successCount,
      failed: result.failedCount,
    })
  } catch (err: any) {
    console.error('Cron reconcile-pegados: ERROR', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
