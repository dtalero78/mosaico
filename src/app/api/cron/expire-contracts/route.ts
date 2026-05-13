import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'
import { CONTRACT_EXPIRED_SQL } from '@/lib/contract-expiry'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job: Marcar contratos expirados como FINALIZADA
 *
 * Este endpoint se ejecuta automáticamente via cron en Digital Ocean App Platform.
 * Busca estudiantes cuyo contrato ha vencido (finalContrato < hoy)
 * y los marca como:
 * - estado: "FINALIZADA"
 * - estadoInactivo: true
 *
 * Schedule recomendado: 0 12 * * * (todos los días a las 12:00 UTC / 7:00 AM Colombia)
 */
export async function GET(request: NextRequest) {
  try {
    // Validar autorización del cron job
    const authHeader = request.headers.get('authorization')
    const providedSecret = authHeader?.replace('Bearer ', '')

    if (CRON_SECRET && providedSecret !== CRON_SECRET) {
      console.log('Cron expire-contracts: Unauthorized request')
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('Cron expire-contracts: [PostgreSQL] Iniciando proceso de verificación de contratos expirados')

    // 1. Obtener estudiantes con contrato expirado
    // Solo buscar BENEFICIARIOS activos (no en OnHold) con contrato vencido
    const expiredResult = await query(
      `SELECT * FROM "PEOPLE"
       WHERE "tipoUsuario" = 'BENEFICIARIO'
         AND "estadoInactivo" = false
         AND ${CONTRACT_EXPIRED_SQL('"finalContrato"')}
         AND ("estado" IS NULL OR "estado" != 'FINALIZADA')
       ORDER BY "finalContrato" ASC`
    )

    if (expiredResult.rowCount === 0) {
      console.log('Cron expire-contracts: No hay contratos expirados para procesar')
      return NextResponse.json({
        success: true,
        message: 'No hay contratos expirados para procesar',
        processed: 0,
        results: []
      })
    }

    const students = expiredResult.rows
    console.log(`Cron expire-contracts: Encontrados ${students.length} contratos expirados`)

    // 2. Marcar cada estudiante como FINALIZADA
    const results: Array<{
      studentId: string
      nombre: string
      success: boolean
      error?: string
      finalContrato?: string
    }> = []

    // Collect unique contracts to update TITULARs once per contract
    const contratosSeen = new Set<string>();

    for (const student of students) {
      try {
        console.log(`Cron expire-contracts: Marcando contrato expirado ${student._id} - ${student.primerNombre} ${student.primerApellido}`)

        // 1. PEOPLE — BENEFICIARIO: estadoInactivo + FINALIZADA
        await query(
          `UPDATE "PEOPLE" SET "estado" = 'FINALIZADA', "estadoInactivo" = true, "_updatedDate" = NOW()
           WHERE "_id" = $1`,
          [student._id]
        )

        // 2. ACADEMICA — BENEFICIARIO: estadoInactivo by numeroId
        if (student.numeroId) {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = true, "_updatedDate" = NOW()
             WHERE "numeroId" = $1`,
            [student.numeroId]
          ).catch(() => {})
        }

        // 3. USUARIOS_ROLES — BENEFICIARIO: activo = false by email
        if (student.email) {
          await query(
            `UPDATE "USUARIOS_ROLES" SET "activo" = false, "_updatedDate" = NOW()
             WHERE LOWER("email") = LOWER($1)`,
            [student.email]
          ).catch(() => {})
        }

        // 4. PEOPLE — TITULAR: estadoInactivo + FINALIZADA (once per contract)
        if (student.contrato && !contratosSeen.has(student.contrato)) {
          contratosSeen.add(student.contrato);
          await query(
            `UPDATE "PEOPLE" SET "estado" = 'FINALIZADA', "estadoInactivo" = true, "_updatedDate" = NOW()
             WHERE "contrato" = $1 AND "tipoUsuario" = 'TITULAR'
               AND ("estadoInactivo" IS NULL OR "estadoInactivo" = false)`,
            [student.contrato]
          ).catch(() => {})
        }

        console.log(`Cron expire-contracts: Estudiante ${student._id} procesado (PEOPLE + ACADEMICA + USUARIOS_ROLES + TITULAR)`)

        results.push({
          studentId: student._id,
          nombre: `${student.primerNombre} ${student.primerApellido}`,
          success: true,
          finalContrato: student.finalContrato
        })
      } catch (studentError) {
        console.error(`Cron expire-contracts: Error procesando estudiante ${student._id}:`, studentError)

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

    console.log(`Cron expire-contracts: Proceso completado. Exitosos: ${successful}, Fallidos: ${failed}`)

    return NextResponse.json({
      success: true,
      message: `Proceso completado. ${successful} contratos marcados como FINALIZADA, ${failed} fallidos.`,
      processed: students.length,
      successful,
      failed,
      results,
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

// También soportar POST para pruebas manuales
export async function POST(request: NextRequest) {
  return GET(request)
}
