import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'
import { recordCronRun } from '@/lib/cron-runs'
import { debeCancelarse, corteCancelacion } from '@/lib/nivelacion-confirmacion'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job: cancelar las nivelaciones que nadie confirmó
 *
 * Corre los **jueves a las 22:00 de Chile** (cron-worker con `timezone`, no en
 * UTC: Chile cambia de huso dos veces al año y con una hora UTC fija el corte se
 * movería solo). Trece horas después de que se le cierra la puerta al alumno —
 * ese margen es para que Servicio pueda confirmar a mano lo que haga falta.
 *
 * Cancela la nivelación **sólo si se cumplen las tres**:
 *   - está viva (pedida o aprobada) y sin confirmar;
 *   - su corte de las 22:00 ya pasó;
 *   - **no tiene evento agendado**.
 *
 * La última condición es la importante: si ya se agrupó, hay un guía y un
 * horario comprometidos y borrarla dejaría un evento con un asistente menos sin
 * que nadie se enterara. Esas se gestionan a mano.
 *
 * Queda entrada en `NivelacionHistory` con resultado `CANCELADA_SIN_CONFIRMAR`:
 * sin ella la nivelación se evaporaría y nadie podría explicar por qué.
 */
export async function GET(request: NextRequest) {
  const providedSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recordCronRun('cancelar-nivelaciones-sin-confirmar', async () => {
      // Candidatas: vivas, con detalle y SIN confirmar. El corte exacto se
      // evalúa en JS con el mismo helper que usa la UI, no con SQL, para que la
      // regla del jueves viva en un solo sitio.
      const { rows } = await query<any>(
        `SELECT a."_id", a."numeroId", a."detalleNivelacion",
                COALESCE(a."NivelacionCount", 0)::int AS conteo,
                COALESCE(a."NivelacionHistory", '[]'::jsonb) AS historial,
                TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."primerApellido"), '\\s+', ' ', 'g')) AS nombre
           FROM "ACADEMICA" a
           LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
          WHERE (a."nivelacion" = true OR a."aprobadoNivelacion" = true)
            AND a."detalleNivelacion" IS NOT NULL
            AND (a."detalleNivelacion"->>'confirmadoEn') IS NULL`
      )

      const vencidas = rows.filter(r => debeCancelarse(r.detalleNivelacion))
      if (!vencidas.length) {
        return { processedCount: 0, successCount: 0, failedCount: 0, metadata: { candidatas: rows.length, details: [] } }
      }

      // Las que YA tienen evento no se tocan: hay un guía y un horario dados.
      const eventos = (await query<{ _id: string }>(
        `SELECT "_id" FROM "CALENDARIO" WHERE UPPER(COALESCE("tipo", '')) = 'NIVELACION'`
      )).rows.map(e => e._id)
      const conEvento = new Set<string>()
      if (eventos.length) {
        const filas = (await query<any>(
          `SELECT DISTINCT b."idEstudiante", b."studentId"
             FROM "ACADEMICA_BOOKINGS" b
            WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
              AND b."cancelo" IS NOT TRUE`,
          [eventos]
        )).rows
        for (const f of filas) {
          if (f.idEstudiante) conEvento.add(f.idEstudiante)
          if (f.studentId) conEvento.add(f.studentId)
        }
      }

      const details: any[] = []
      let ok = 0, fail = 0, saltadas = 0

      for (const r of vencidas) {
        if (conEvento.has(r._id)) {
          saltadas++
          details.push({ academicaId: r._id, nombre: r.nombre, accion: 'OMITIDA_TIENE_EVENTO' })
          continue
        }
        try {
          const det = r.detalleNivelacion || {}
          const entry = {
            fecha: new Date().toISOString(),
            fechaEvento: null,
            fechaSolicitud: det.fecha || null,
            modulo: det.modulo || null,
            leccion: det.leccion || null,
            conteo: r.conteo,
            confirmadoEn: null,
            confirmadoPor: null,
            resultado: 'CANCELADA_SIN_CONFIRMAR',
            comentario: `Cancelada automáticamente: nadie confirmó antes del ${corteCancelacion(det.fecha)} (hora de Chile).`,
            marcadoPor: 'cron@lgs-plataforma.com',
          }
          const hist = Array.isArray(r.historial) ? r.historial : []
          await query(
            `UPDATE "ACADEMICA"
                SET "nivelacion" = false,
                    "aprobadoNivelacion" = false,
                    "detalleNivelacion" = NULL,
                    "NivelacionCount" = $2,
                    "NivelacionHistory" = $3::jsonb,
                    "_updatedDate" = NOW()
              WHERE "_id" = $1`,
            [r._id, Math.max(0, r.conteo - 1), JSON.stringify([...hist, entry])]
          )
          ok++
          details.push({ academicaId: r._id, nombre: r.nombre, accion: 'CANCELADA', leccion: det.leccion || null })
        } catch (e: any) {
          fail++
          details.push({ academicaId: r._id, nombre: r.nombre, accion: 'ERROR', error: e?.message })
        }
      }

      return {
        processedCount: vencidas.length,
        successCount: ok,
        failedCount: fail,
        metadata: { candidatas: rows.length, vencidas: vencidas.length, saltadasConEvento: saltadas, details },
      }
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('Cron cancelar-nivelaciones-sin-confirmar:', error)
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 })
  }
}
