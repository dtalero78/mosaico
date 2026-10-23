import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cron-runs'
import { sincronizarAvanceCalendario } from '@/services/avance-calendario.service'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job (MOSAICO): avance de módulo/lección por CALENDARIO.
 *
 * La posición de cada alumno es la lección de la siguiente sesión de su salón que aún
 * no termina (ver avance-calendario.service). Corre cada 15 minutos: una sesión que
 * termina adelanta a todo su salón en el siguiente ciclo.
 *
 * Parámetros opcionales (para revisar sin escribir): ?dryRun=1 · ?campaign=NOMBRE ·
 * ?detalle=1 (devuelve la lista de cambios). Con dryRun no queda registro en CRON_RUNS.
 */
export async function GET(request: NextRequest) {
  const providedSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const sp = new URL(request.url).searchParams
  const dryRun = sp.get('dryRun') === '1'
  const campaign = sp.get('campaign') || undefined
  const detalle = sp.get('detalle') === '1'

  try {
    if (dryRun) {
      const r = await sincronizarAvanceCalendario({ dryRun: true, campaign })
      return NextResponse.json({ success: true, dryRun: true, ...r, cambios: detalle ? r.cambios : r.cambios.slice(0, 20) })
    }
    const run = await recordCronRun('avance-calendario', async () => {
      const r = await sincronizarAvanceCalendario({ campaign })
      return {
        processedCount: r.alumnosRevisados,
        successCount: r.alumnosCambiados,
        failedCount: 0,
        // Sólo se guarda el detalle cuando es acotado (el primer barrido mueve a todos).
        metadata: { salonesRevisados: r.salonesRevisados, salonesSinEquivalente: r.salonesSinEquivalente.length, salonesConPosicion: r.salonesConPosicion,
          academicaActualizadas: r.academicaActualizadas, peopleActualizadas: r.peopleActualizadas,
          details: r.cambios.length <= 300 ? r.cambios : r.cambios.slice(0, 300) },
        _full: r,
      } as any
    })
    const full = (run as any)?._full
    return NextResponse.json({ success: true, message: 'Avance por calendario aplicado', ...(full || {}), cambios: detalle ? full?.cambios : undefined })
  } catch (e) {
    console.error('avance-calendario:', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
