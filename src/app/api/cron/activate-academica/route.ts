import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/postgres'
import { recordCronRun } from '@/lib/cron-runs'

const CRON_SECRET = process.env.CRON_SECRET

/**
 * Cron Job (MOSAICO): Activar académicamente a los beneficiarios 1 SEMANA ANTES
 * del inicio de su curso.
 *
 * Llamado por cron-worker (Node.js daemon en Digital Ocean) una vez al día con
 * Authorization: Bearer <CRON_SECRET>. Cada ejecución queda en CRON_RUNS.
 *
 * Flujo de negocio:
 *   - Al crear el contrato, cada beneficiario nace con ACADEMICA.estadoInactivo=true
 *     y USUARIOS_ROLES.activo=false (login bloqueado).
 *   - Al aprobar, PEOPLE pasa a activo/Aprobado y se precargan los bookings, pero
 *     ACADEMICA y el login SIGUEN inactivos.
 *   - Este cron los enciende cuando faltan <= 7 días para `inicioCurso`, SÓLO si el
 *     beneficiario está APROBADO (PEOPLE.aprobacion='Aprobado').
 *
 * Por cada ACADEMICA elegible:
 *   - ACADEMICA.estadoInactivo = false
 *   - USUARIOS_ROLES.activo = true (por numberid = numeroId, o por email)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const providedSecret = authHeader?.replace('Bearer ', '')
  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await recordCronRun('activate-academica', async () => {
      // ACADEMICA inactivos, aprobados, con inicioCurso a <= 7 días
      const elegibles = await query(
        `SELECT a."_id", a."numeroId", a."email", a."userLogin", a."primerNombre", a."primerApellido", a."inicioCurso"
           FROM "ACADEMICA" a
           JOIN "PEOPLE" p ON p."_id" = a."peopleId"
          WHERE a."estadoInactivo" = true
            AND a."inicioCurso" IS NOT NULL
            AND (a."inicioCurso"::date - INTERVAL '7 days') <= CURRENT_DATE
            AND p."aprobacion" = 'Aprobado'
          ORDER BY a."inicioCurso" ASC`
      )

      const rows = elegibles.rows
      if (rows.length === 0) {
        return { processedCount: 0, successCount: 0, failedCount: 0, metadata: { details: [] } }
      }

      const details: Array<{ academicId: string; nombre: string; success: boolean; loginActivado: boolean; error?: string }> = []

      for (const a of rows) {
        try {
          await query(
            `UPDATE "ACADEMICA" SET "estadoInactivo" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
            [a._id]
          )
          let loginActivado = false
          // CRON-19: activar por userLogin (1:1, preciso) cuando existe — evita activar
          // prematuramente a un hermano con email compartido. Fallback legacy: numberid/email.
          const up = await query(
            `UPDATE "USUARIOS_ROLES"
                SET "activo" = true, "_updatedDate" = NOW()
              WHERE ($3 <> '' AND "userLogin" = $3)
                 OR ($3 = '' AND ("numberid" = $1 OR ($2 <> '' AND LOWER("email") = LOWER($2))))`,
            [a.numeroId, a.email || '', a.userLogin || '']
          )
          loginActivado = (up.rowCount ?? 0) > 0
          details.push({
            academicId: a._id,
            nombre: `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim(),
            success: true,
            loginActivado,
          })
        } catch (err) {
          details.push({
            academicId: a._id,
            nombre: `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim(),
            success: false,
            loginActivado: false,
            error: err instanceof Error ? err.message : 'Error desconocido',
          })
        }
      }

      const successful = details.filter(r => r.success).length
      const failed = details.filter(r => !r.success).length
      return { processedCount: rows.length, successCount: successful, failedCount: failed, metadata: { details } }
    })

    return NextResponse.json({
      success: true,
      message: result.processedCount === 0
        ? 'No hay beneficiarios para activar (ninguno a <=7 días del inicio del curso)'
        : `Proceso completado. ${result.successCount} activados, ${result.failedCount} fallidos.`,
      processed: result.processedCount,
      successful: result.successCount,
      failed: result.failedCount,
      results: result.metadata?.details ?? [],
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron activate-academica: Error general:', error)
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor', details: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
