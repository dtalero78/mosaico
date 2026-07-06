import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'
import { CONTRACT_EXPIRED_SQL } from '@/lib/contract-expiry'
import { recordCronRun } from '@/lib/cron-runs'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job: Marcar contratos expirados como FINALIZADA
 *
 * Llamado por cron-worker (Node.js daemon en Digital Ocean) a las 04:00 UTC
 * todos los días con Authorization: Bearer <CRON_SECRET>.
 *
 * Cada ejecución queda registrada en CRON_RUNS via recordCronRun() — el
 * endpoint /api/cron/health-check expone la última ejecución para detectar
 * si el cron lleva mucho sin correr.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
    console.log('Cron expire-contracts: Unauthorized request')
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recordCronRun('expire-contracts', async () => {
      console.log('Cron expire-contracts: [PostgreSQL] Iniciando proceso de verificación de contratos expirados')

      // Solo buscar BENEFICIARIOS activos (no en OnHold) con contrato vencido
      const expiredResult = await query(
        `SELECT * FROM "PEOPLE"
         WHERE "tipoUsuario" = 'BENEFICIARIO'
           AND "estadoInactivo" = false
           AND ${CONTRACT_EXPIRED_SQL('"finalContrato"')}
           AND ("estado" IS NULL OR "estado" != 'FINALIZADA')
         ORDER BY "finalContrato" ASC`
      )

      const students = expiredResult.rows
      if (students.length === 0) {
        console.log('Cron expire-contracts: No hay contratos expirados para procesar')
        return { processedCount: 0, successCount: 0, failedCount: 0, metadata: { details: [] } }
      }

      console.log(`Cron expire-contracts: Encontrados ${students.length} contratos expirados`)

      const details: Array<{
        studentId: string
        nombre: string
        success: boolean
        error?: string
        finalContrato?: string
      }> = []

      // Collect unique contracts to update TITULARs once per contract
      const contratosSeen = new Set<string>()

      for (const student of students) {
        try {
          console.log(`Cron expire-contracts: Marcando contrato expirado ${student._id} - ${student.primerNombre} ${student.primerApellido}`)

          await query(
            `UPDATE "PEOPLE" SET "estado" = 'FINALIZADA', "estadoInactivo" = true, "_updatedDate" = NOW()
             WHERE "_id" = $1`,
            [student._id]
          )

          if (student.numeroId) {
            await query(
              `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW()
               WHERE "numeroId" = $1`,
              [student.numeroId]
            ).catch(() => {})
          }

          if (student.email) {
            await query(
              `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
               WHERE LOWER("email") = LOWER($1)`,
              [student.email]
            ).catch(() => {})
          }

          if (student.contrato && !contratosSeen.has(student.contrato)) {
            contratosSeen.add(student.contrato)
            await query(
              `UPDATE "PEOPLE" SET "estado" = 'FINALIZADA', "estadoInactivo" = true, "_updatedDate" = NOW()
               WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
                 AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)`,
              [student.contrato]
            ).catch(() => {})
          }

          console.log(`Cron expire-contracts: Estudiante ${student._id} procesado (PEOPLE + ACADEMICA + USUARIOS_ROLES + TITULAR)`)
          details.push({
            studentId: student._id,
            nombre: `${student.primerNombre} ${student.primerApellido}`,
            success: true,
            finalContrato: student.finalContrato
          })
        } catch (studentError) {
          console.error(`Cron expire-contracts: Error procesando estudiante ${student._id}:`, studentError)
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
      console.log(`Cron expire-contracts: Proceso completado. Exitosos: ${successful}, Fallidos: ${failed}`)

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
        ? 'No hay contratos expirados para procesar'
        : `Proceso completado. ${result.successCount} contratos marcados como FINALIZADA, ${result.failedCount} fallidos.`,
      processed: result.processedCount,
      successful: result.successCount,
      failed: result.failedCount,
      results: result.metadata?.details ?? [],
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Cron expire-contracts: Error general:', error)
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
