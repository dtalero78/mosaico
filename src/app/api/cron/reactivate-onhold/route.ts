import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job: Reactivar estudiantes con OnHold vencido
 *
 * Este endpoint se ejecuta automáticamente via cron en Digital Ocean App Platform.
 * Busca estudiantes cuyo período OnHold ha vencido (fechaFinOnHold <= hoy)
 * y los reactiva automáticamente, extendiendo su vigencia.
 *
 * Configuración en Digital Ocean App Platform:
 * - Job Type: Cron
 * - Schedule: 0 6 * * * (todos los días a las 6:00 AM)
 * - HTTP Route: GET /api/cron/reactivate-onhold
 * - Header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  try {
    // Validar autorización del cron job
    const authHeader = request.headers.get('authorization')
    const providedSecret = authHeader?.replace('Bearer ', '')

    // En producción, validar el secret
    if (CRON_SECRET && providedSecret !== CRON_SECRET) {
      console.log('Cron reactivate-onhold: Unauthorized request')
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('Cron reactivate-onhold: [PostgreSQL] Iniciando proceso de reactivación automática')

    // 1. Obtener estudiantes con OnHold vencido
    const expiredResult = await query(
      `SELECT * FROM "PEOPLE"
       WHERE "estadoInactivo" = true
         AND "fechaFinOnHold" IS NOT NULL
         AND "fechaFinOnHold"::date <= CURRENT_DATE
       ORDER BY "fechaFinOnHold" ASC`
    )

    if (expiredResult.rowCount === 0) {
      console.log('Cron reactivate-onhold: No hay estudiantes con OnHold vencido')
      return NextResponse.json({
        success: true,
        message: 'No hay estudiantes con OnHold vencido para reactivar',
        processed: 0,
        results: []
      })
    }

    const students = expiredResult.rows
    console.log(`Cron reactivate-onhold: Encontrados ${students.length} estudiantes con OnHold vencido`)

    // 2. Reactivar cada estudiante
    const results: Array<{
      studentId: string
      nombre: string
      success: boolean
      error?: string
      diasExtendidos?: number
    }> = []

    for (const student of students) {
      try {
        console.log(`Cron reactivate-onhold: Reactivando estudiante ${student._id} - ${student.primerNombre} ${student.primerApellido}`)

        // Calculate days paused
        const fechaOnHold = new Date(student.fechaOnHold)
        const fechaFinOnHold = new Date(student.fechaFinOnHold)
        const diasPausados = Math.ceil((fechaFinOnHold.getTime() - fechaOnHold.getTime()) / (1000 * 60 * 60 * 24))

        // Calculate new finalContrato
        let newFinalContrato = student.finalContrato
        if (student.finalContrato) {
          const finalDate = new Date(student.finalContrato)
          finalDate.setDate(finalDate.getDate() + diasPausados)
          newFinalContrato = finalDate.toISOString().split('T')[0]
        }

        // Update the student
        await query(
          `UPDATE "PEOPLE" SET
            "estadoInactivo" = false,
            "fechaOnHold" = NULL,
            "fechaFinOnHold" = NULL,
            "finalContrato" = $2,
            "extensionCount" = COALESCE("extensionCount", 0) + 1,
            "extensionHistory" = COALESCE("extensionHistory", '[]'::jsonb) || $3::jsonb,
            "_updatedDate" = NOW()
          WHERE "_id" = $1`,
          [
            student._id,
            newFinalContrato,
            JSON.stringify({
              numero: (student.extensionCount || 0) + 1,
              fechaEjecucion: new Date().toISOString(),
              vigenciaAnterior: student.finalContrato,
              vigenciaNueva: newFinalContrato,
              diasExtendidos: diasPausados,
              motivo: `Extensión automática por OnHold (${diasPausados} días pausados desde ${student.fechaOnHold} hasta ${student.fechaFinOnHold}) - Cron Job`
            })
          ]
        )

        // Sync ACADEMICA.estadoInactivo (por numeroId). Sin esto el estudiante
        // queda en estado inconsistente: puede loguear pero NO puede agendar
        // (validación de booking bloquea cuando ACADEMICA.estadoInactivo=true).
        if (student.numeroId) {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "numeroId" = $1`,
            [student.numeroId]
          ).catch(err => console.warn(`Cron reactivate-onhold: ACADEMICA sync failed for ${student.numeroId}:`, err))
        }

        console.log(`Cron reactivate-onhold: Estudiante ${student._id} reactivado exitosamente`)

        results.push({
          studentId: student._id,
          nombre: `${student.primerNombre} ${student.primerApellido}`,
          success: true,
          diasExtendidos: diasPausados
        })
      } catch (studentError) {
        console.error(`Cron reactivate-onhold: Error procesando estudiante ${student._id}:`, studentError)

        results.push({
          studentId: student._id,
          nombre: `${student.primerNombre} ${student.primerApellido}`,
          success: false,
          error: studentError instanceof Error ? studentError.message : 'Error desconocido'
        })
      }
    }

    // 3. Generar resumen
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`Cron reactivate-onhold: Proceso completado. Exitosos: ${successful}, Fallidos: ${failed}`)

    return NextResponse.json({
      success: true,
      message: `Proceso completado. ${successful} estudiantes reactivados, ${failed} fallidos.`,
      processed: students.length,
      successful,
      failed,
      results,
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

// También soportar POST para pruebas manuales
export async function POST(request: NextRequest) {
  return GET(request)
}
