import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'
import { recordCronRun } from '@/lib/cron-runs'
import { hoyEnChile } from '@/lib/cursos-campaign'
import { deactivateOnHold } from '@/services/contract.service'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job: Reactivar estudiantes con OnHold vencido
 *
 * Llamado por cron-worker (Node.js daemon en Digital Ocean) a las 03:00 UTC
 * todos los días con Authorization: Bearer <CRON_SECRET>.
 *
 * Cada ejecución queda registrada en CRON_RUNS via recordCronRun() — el
 * endpoint /api/cron/health-check expone la última ejecución para detectar
 * si el cron lleva mucho sin correr.
 *
 * Por cada estudiante con OnHold vencido llama a `deactivateOnHold` (la misma
 * reactivación del botón de la ficha). El alumno vuelve SIN salón —lo soltó al
 * pausarse— y aparece en Servicio › Reactivados sin salón para asignárselo.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    console.log('Cron reactivate-onhold: Unauthorized request')
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recordCronRun('reactivate-onhold', async () => {
      console.log('Cron reactivate-onhold: [PostgreSQL] Iniciando proceso de reactivación automática')

      // El OnHold lo define tener fechaOnHold (no estadoInactivo). El día se mide
      // en Chile, como el resto de la reactivación.
      const expiredResult = await query(
        `SELECT "_id", "primerNombre", "primerApellido" FROM "PEOPLE"
         WHERE "fechaOnHold" IS NOT NULL
           AND "fechaFinOnHold" IS NOT NULL
           AND "fechaFinOnHold"::date <= $1::date
         ORDER BY "fechaFinOnHold" ASC`,
        [hoyEnChile()]
      )

      const students = expiredResult.rows
      if (students.length === 0) {
        console.log('Cron reactivate-onhold: No hay estudiantes con OnHold vencido')
        return {
          processedCount: 0,
          successCount: 0,
          failedCount: 0,
          metadata: { details: [] },
        }
      }

      console.log(`Cron reactivate-onhold: Encontrados ${students.length} estudiantes con OnHold vencido`)

      const details: Array<{
        studentId: string
        nombre: string
        success: boolean
        error?: string
        diasExtendidos?: number
      }> = []

      for (const student of students) {
        try {
          console.log(`Cron reactivate-onhold: Reactivando estudiante ${student._id} - ${student.primerNombre} ${student.primerApellido}`)

          // La MISMA reactivación que el botón de la ficha: login por identidad,
          // estado ACTIVA, extensión por los días pausados y SIN contar extensión.
          const r = await deactivateOnHold(student._id, { modo: 'AUTOMATICO', actor: 'cron' })

          console.log(`Cron reactivate-onhold: Estudiante ${student._id} reactivado exitosamente`)
          details.push({
            studentId: student._id,
            nombre: `${student.primerNombre} ${student.primerApellido}`,
            success: true,
            diasExtendidos: r.extension.daysPaused,
          })
        } catch (studentError) {
          console.error(`Cron reactivate-onhold: Error procesando estudiante ${student._id}:`, studentError)
          details.push({
            studentId: student._id,
            nombre: `${student.primerNombre} ${student.primerApellido}`,
            success: false,
            error: studentError instanceof Error ? studentError.message : 'Error desconocido'
          })
        }
      }

      const successful = details.filter(r => r.success).length
      const failed = details.filter(r => !r.success).length
      console.log(`Cron reactivate-onhold: Proceso completado. Exitosos: ${successful}, Fallidos: ${failed}`)

      return {
        processedCount: students.length,
        successCount: successful,
        failedCount: failed,
        metadata: { details },
      }
    })

    return NextResponse.json({
      success: true,
      message: result.processedCount === 0
        ? 'No hay estudiantes con OnHold vencido para reactivar'
        : `Proceso completado. ${result.successCount} estudiantes reactivados, ${result.failedCount} fallidos.`,
      processed: result.processedCount,
      successful: result.successCount,
      failed: result.failedCount,
      results: result.metadata?.details ?? [],
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Cron reactivate-onhold: Error general:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        details: error instanceof Error ? error.message : 'Error desconocido'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
