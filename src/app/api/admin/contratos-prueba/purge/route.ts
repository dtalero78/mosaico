import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { withTransaction } from '@/lib/postgres'
import { ValidationError } from '@/lib/errors'
import { MantenimientoPermission } from '@/types/permissions'
import { ids } from '@/lib/id-generator'

/**
 * POST /api/admin/contratos-prueba/purge
 *   body: { contratos: string[], motivo: string }
 *
 * Borra en CASCADA todos los registros asociados a cada `contrato` de prueba.
 * Por cada contrato, ejecuta una transacción ATÓMICA que:
 *   1. Snapshotea cada tabla a borrar -> objeto JSONB completo.
 *   2. INSERT en PURGE_LOG con el snapshot + actor + motivo (auditoría).
 *   3. DELETE en orden seguro (de las dependientes hacia PEOPLE).
 * Si cualquier paso falla, ROLLBACK total → el contrato queda intacto.
 *
 * Tablas afectadas por contrato (en orden de borrado):
 *   STEP_OVERRIDES → COMPLEMENTARIA_ATTEMPTS → ACADEMICA_BOOKINGS
 *   → PAGOS_TITULARES → ACADEMICA → FINANCIEROS → USUARIOS_ROLES → PEOPLE
 *
 * Gateado por MANTENIMIENTO.USUARIOS.CONTRATOS_PRUEBA.
 */

interface PurgeResultItem {
  contrato: string
  status: 'ok' | 'error' | 'not_test'
  error?: string
  borrados?: {
    people: number
    academica: number
    bookings: number
    financieros: number
    pagos: number
    stepOverrides: number
    complementarias: number
    usuariosRoles: number
  }
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, MantenimientoPermission.CONTRATOS_PRUEBA)

  const { contratos, motivo } = await request.json()
  if (!Array.isArray(contratos) || !contratos.length) throw new ValidationError('contratos requerido')
  if (typeof motivo !== 'string' || !motivo.trim()) throw new ValidationError('motivo es obligatorio')
  if (contratos.length > 100) throw new ValidationError('Máximo 100 contratos por operación')

  const actorEmail  = (session?.user as any)?.email ?? ''
  const actorNombre = (session?.user as any)?.name ?? null
  // x-forwarded-for puede traer chain "cliente, proxy1, proxy2..." en producción.
  // Tomamos la primera IP (cliente real) y truncamos a 45 para caber en VARCHAR(50).
  const ipRaw      = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || ''
  const ip         = ipRaw.split(',')[0].trim().slice(0, 45)
  const userAgent  = request.headers.get('user-agent') || ''

  const results: PurgeResultItem[] = []

  for (const contrato of contratos) {
    // Defensa en profundidad: NUNCA borrar nada que no tenga prefijo PRB-.
    if (typeof contrato !== 'string' || !/^PRB-/i.test(contrato)) {
      results.push({ contrato: String(contrato), status: 'not_test', error: 'No es contrato de prueba (sin prefijo PRB-)' })
      continue
    }

    try {
      const borrados = await withTransaction(async (client) => {
        // 1) Snapshot completo ANTES de borrar nada (todas las tablas).
        const peopleSnap = await client.query(`SELECT * FROM "PEOPLE" WHERE "contrato" = $1`, [contrato])
        const numeroIds = Array.from(new Set(peopleSnap.rows.map(p => p.numeroId).filter(Boolean)))
        const peopleIds = peopleSnap.rows.map(p => p._id)
        const emails    = Array.from(new Set(peopleSnap.rows.map(p => (p.email || '').toLowerCase()).filter(Boolean)))

        const academicaSnap = numeroIds.length
          ? await client.query(`SELECT * FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds])
          : { rows: [] }
        const academicaIds = academicaSnap.rows.map((a: any) => a._id)

        const bookingsSnap = academicaIds.length
          ? await client.query(`SELECT * FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds])
          : { rows: [] }
        const finSnap     = await client.query(`SELECT * FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato])
        // PAGOS_TITULARES no tiene "contrato" directo. Borramos por las DOS llaves
        // disponibles (idPeople = FK a PEOPLE, numeroId = ID del titular) para
        // que no queden huérfanos si alguno quedó desincronizado.
        const pagosSnap = (peopleIds.length || numeroIds.length)
          ? await client.query(`
              SELECT * FROM "PAGOS_TITULARES"
              WHERE ("idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[]))`,
              [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']])
          : { rows: [] }
        const overridesSnap = academicaIds.length
          ? await client.query(`SELECT * FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds])
          : { rows: [] }
        const complemSnap = academicaIds.length
          ? await client.query(`SELECT * FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => ({ rows: [] }))
          : { rows: [] }
        const usuariosSnap = emails.length
          ? await client.query(`SELECT * FROM "USUARIOS_ROLES" WHERE LOWER("email") = ANY($1::text[])`, [emails])
          : { rows: [] }

        const titular = peopleSnap.rows.find(p => p.tipoUsuario === 'TITULAR')
        const titularNombre = titular ? `${titular.primerNombre || ''} ${titular.primerApellido || ''}`.trim() : null

        const snapshot = {
          people: peopleSnap.rows,
          academica: academicaSnap.rows,
          bookings: bookingsSnap.rows,
          financieros: finSnap.rows,
          pagos: pagosSnap.rows,
          stepOverrides: overridesSnap.rows,
          complementarias: complemSnap.rows,
          usuariosRoles: usuariosSnap.rows,
        }
        const filasBorradas = {
          people: peopleSnap.rows.length,
          academica: academicaSnap.rows.length,
          bookings: bookingsSnap.rows.length,
          financieros: finSnap.rows.length,
          pagos: pagosSnap.rows.length,
          stepOverrides: overridesSnap.rows.length,
          complementarias: complemSnap.rows.length,
          usuariosRoles: usuariosSnap.rows.length,
        }

        // 2) Auditoría → PURGE_LOG (antes de borrar).
        await client.query(`
          INSERT INTO "PURGE_LOG"
            ("_id", "tipoPurga", "contrato", "titularId", "titularNombre",
             "snapshot", "motivo", "realizadoPor", "realizadoPorNombre",
             "ip", "userAgent", "filasBorradas")
          VALUES ($1, 'CONTRATO_PRUEBA', $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11::jsonb)`,
          [ids.audit(), contrato, titular?._id ?? null, titularNombre,
           JSON.stringify(snapshot), motivo.trim(), actorEmail, actorNombre,
           ip, userAgent, JSON.stringify(filasBorradas)])

        // 3) DELETE en orden seguro (dependientes → PEOPLE último).
        if (academicaIds.length) {
          await client.query(`DELETE FROM "STEP_OVERRIDES" WHERE "studentId" = ANY($1::text[])`, [academicaIds])
          await client.query(`DELETE FROM "COMPLEMENTARIA_ATTEMPTS" WHERE "studentId" = ANY($1::text[])`, [academicaIds]).catch(() => null)
          await client.query(`DELETE FROM "ACADEMICA_BOOKINGS" WHERE "studentId" = ANY($1::text[]) OR "idEstudiante" = ANY($1::text[])`, [academicaIds])
        }
        if (peopleIds.length || numeroIds.length) {
          await client.query(`
            DELETE FROM "PAGOS_TITULARES"
            WHERE ("idPeople" = ANY($1::text[]) OR "numeroId" = ANY($2::text[]))`,
            [peopleIds.length ? peopleIds : ['__none__'], numeroIds.length ? numeroIds : ['__none__']])
        }
        if (numeroIds.length) {
          await client.query(`DELETE FROM "ACADEMICA" WHERE "numeroId" = ANY($1::text[])`, [numeroIds])
        }
        await client.query(`DELETE FROM "FINANCIEROS" WHERE "contrato" = $1`, [contrato])
        if (emails.length) {
          await client.query(`DELETE FROM "USUARIOS_ROLES" WHERE LOWER("email") = ANY($1::text[])`, [emails])
        }
        await client.query(`DELETE FROM "PEOPLE" WHERE "contrato" = $1`, [contrato])

        return filasBorradas
      })

      results.push({ contrato, status: 'ok', borrados })
    } catch (err: any) {
      console.error(`[purge contrato-prueba] ${contrato}:`, err?.message || err)
      results.push({ contrato, status: 'error', error: err?.message || 'Error desconocido' })
    }
  }

  const ok = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'error').length
  return successResponse({
    message: `Purga completada: ${ok} OK · ${failed} fallidos · ${results.length} total`,
    results,
    ok, failed, total: results.length,
  })
})
