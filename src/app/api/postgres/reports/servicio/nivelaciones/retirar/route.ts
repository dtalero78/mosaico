import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query, withTransaction } from '@/lib/postgres'
import { ValidationError, ConflictError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import { agendamientosDeNivelacionActual } from '@/services/nivelacion-agendada.service'
import {
  motivoRechazoRetiro, marcasDevolucion, entradaRemovida, conteoAlRemover,
  type AccionRetiro,
} from '@/lib/nivelacion-retiro'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/retirar
 * Body: { accion: 'devolver' | 'remover', academicaIds: string[], motivo? }
 *
 * Saca de **Agrupaciones** una nivelación que todavía no se agenda (la regla
 * está en `lib/nivelacion-retiro`):
 *
 *   devolver  vuelve a Solicitudes, sin aprobar, tal como la pidió el guía
 *   remover   se cancela: queda en el Histórico como «Removida» y el conteo baja 1
 *
 * Sólo aplica a lo que ESTÁ en Agrupaciones —aprobada y sin evento—. Si ya tiene
 * evento está en Pendientes: hay un guía y un horario comprometidos y un
 * agendamiento vivo, así que retirarla por aquí lo dejaría colgando. Esa se
 * cierra desde Pendientes.
 *
 * Todo el lote va en UNA transacción: si uno no se puede retirar, no se retira
 * ninguno, y la pantalla dice cuál fue.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)

  const body = await request.json().catch(() => ({}))
  const accion = String(body?.accion || '').trim()
  const motivo = String(body?.motivo || '').trim()
  const academicaIds: string[] = Array.from(new Set<string>(
    (Array.isArray(body?.academicaIds) ? body.academicaIds : [])
      .filter((x: any) => typeof x === 'string' && x.trim())
      .map((x: string) => x.trim())
  ))

  const rechazo = motivoRechazoRetiro(accion, academicaIds, motivo)
  if (rechazo) throw new ValidationError(rechazo)
  const tipo = accion as AccionRetiro

  const alumnos = (await query<{
    _id: string; nombre: string; aprobadoNivelacion: boolean | null
    detalleNivelacion: any; conteo: number
  }>(
    `SELECT a."_id", a."aprobadoNivelacion", a."detalleNivelacion",
            COALESCE(a."NivelacionCount", 0)::int AS conteo,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ',
              COALESCE(p."primerNombre", a."primerNombre"),
              COALESCE(p."primerApellido", a."primerApellido")), '\\s+', ' ', 'g')) AS nombre
       FROM "ACADEMICA" a
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE a."_id" = ANY($1::text[])`,
    [academicaIds]
  )).rows

  if (alumnos.length !== academicaIds.length) {
    throw new ValidationError('Alguno de los usuarios seleccionados ya no existe')
  }

  const nombres = (lista: typeof alumnos) => lista.map(a => a.nombre || a._id).join(', ')

  const sinAprobar = alumnos.filter(a => a.aprobadoNivelacion !== true)
  if (sinAprobar.length) {
    throw new ConflictError(
      `${nombres(sinAprobar)} ya no está en Agrupaciones. Actualice la pantalla e intente de nuevo.`
    )
  }

  const conEvento = await agendamientosDeNivelacionActual()
  const agendados = alumnos.filter(a => conEvento.has(a._id))
  if (agendados.length) {
    throw new ConflictError(
      `${nombres(agendados)} ya tiene la nivelación agendada: se gestiona desde la pestaña Pendientes.`
    )
  }

  const actor = (session.user as any)?.name || session.user?.email || 'Servicio'
  const ahora = new Date()

  await withTransaction(async (client) => {
    for (const a of alumnos) {
      // `AND "aprobadoNivelacion" = true` cierra la carrera con otro usuario que
      // la agende o la retire entre la lectura y esta escritura.
      const r = tipo === 'devolver'
        ? await client.query(
            // El detalle se arma en la base y no aquí: si el usuario confirma su
            // asistencia justo ahora, escribir el JSON leído arriba se lo pisaría.
            `UPDATE "ACADEMICA"
                SET "nivelacion" = true,
                    "aprobadoNivelacion" = false,
                    "detalleNivelacion" = (COALESCE("detalleNivelacion", '{}'::jsonb) - 'grupoId') || $2::jsonb,
                    "_updatedDate" = NOW()
              WHERE "_id" = $1 AND "aprobadoNivelacion" = true`,
            [a._id, JSON.stringify(marcasDevolucion(actor, ahora))]
          )
        : await client.query(
            `UPDATE "ACADEMICA"
                SET "nivelacion" = false,
                    "aprobadoNivelacion" = false,
                    "detalleNivelacion" = NULL,
                    "NivelacionCount" = $2,
                    "NivelacionHistory" = COALESCE("NivelacionHistory", '[]'::jsonb) || $3::jsonb,
                    "_updatedDate" = NOW()
              WHERE "_id" = $1 AND "aprobadoNivelacion" = true`,
            [
              a._id,
              conteoAlRemover(a.conteo),
              JSON.stringify([entradaRemovida({
                detalle: a.detalleNivelacion, conteo: a.conteo, motivo, actor, ahora,
              })]),
            ]
          )
      if (r.rowCount !== 1) {
        throw new ConflictError(
          `${a.nombre || a._id} cambió mientras se procesaba. No se aplicó ningún cambio: actualice la pantalla e intente de nuevo.`
        )
      }
    }
  })

  return successResponse({
    accion: tipo,
    afectados: alumnos.length,
    usuarios: alumnos.map(a => ({ academicaId: a._id, nombre: a.nombre })),
  })
})
