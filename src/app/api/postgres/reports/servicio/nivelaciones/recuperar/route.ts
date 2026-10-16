import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { withTransaction } from '@/lib/postgres'
import { ValidationError, ConflictError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import {
  MAX_RECUPERACION, motivoNoRecuperable, detalleRecuperado, marcarRecuperada, conteoAlRecuperar,
  type EntradaHistorial,
} from '@/lib/nivelacion-recuperacion'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/recuperar
 * Body: { items: [{ academicaId, fecha }] }   — `fecha` = la de la entrada del histórico
 *
 * Devuelve a **Solicitudes** las nivelaciones que el cron canceló por falta de
 * confirmación (la regla está en `lib/nivelacion-recuperacion`): queda pedida y
 * sin aprobar, el conteo sube 1 y el plazo de confirmación corre de nuevo desde
 * hoy. La entrada del histórico se conserva, marcada como recuperada.
 *
 * Todo el lote va en UNA transacción y con las filas bloqueadas (`FOR UPDATE`):
 * si uno no se puede recuperar no se recupera ninguno, y el mensaje dice cuál y
 * por qué. El bloqueo cierra la carrera con el guía pidiendo otra nivelación o
 * con otro usuario recuperando la misma a la vez.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)

  const body = await request.json().catch(() => ({}))
  const items: { academicaId: string; fecha: string }[] = (Array.isArray(body?.items) ? body.items : [])
    .map((x: any) => ({ academicaId: String(x?.academicaId || '').trim(), fecha: String(x?.fecha || '').trim() }))
    .filter((x: any) => x.academicaId && x.fecha)

  if (!items.length) throw new ValidationError('Selecciona al menos una nivelación')
  if (items.length > MAX_RECUPERACION) throw new ValidationError(`Máximo ${MAX_RECUPERACION} nivelaciones por operación`)
  // Sólo la última entrada de cada alumno es recuperable: dos del mismo alumno
  // en un lote no pueden ser válidas a la vez.
  if (new Set(items.map(i => i.academicaId)).size !== items.length) {
    throw new ValidationError('Hay más de una nivelación del mismo usuario en la selección')
  }

  const actor = (session.user as any)?.name || session.user?.email || 'Servicio'
  const ahora = new Date()

  const usuarios = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT a."_id", a."nivelacion", a."aprobadoNivelacion",
              COALESCE(a."NivelacionCount", 0)::int AS conteo,
              COALESCE(a."NivelacionHistory", '[]'::jsonb) AS historial,
              TRIM(REGEXP_REPLACE(CONCAT_WS(' ',
                COALESCE(p."primerNombre", a."primerNombre"),
                COALESCE(p."primerApellido", a."primerApellido")), '\\s+', ' ', 'g')) AS nombre
         FROM "ACADEMICA" a
         LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
        WHERE a."_id" = ANY($1::text[])
        FOR UPDATE OF a`,
      [items.map(i => i.academicaId)]
    )
    const porId = new Map<string, any>(rows.map((r: any) => [r._id, r]))

    const rechazos: string[] = []
    const planes: { id: string; nombre: string; conteo: number; historial: EntradaHistorial[]; idx: number }[] = []
    for (const it of items) {
      const a = porId.get(it.academicaId)
      if (!a) { rechazos.push(`${it.academicaId}: el usuario ya no existe`); continue }
      const historial: EntradaHistorial[] = Array.isArray(a.historial) ? a.historial : []
      const idx = historial.findIndex(h => String(h?.fecha || '') === it.fecha)
      const motivo = motivoNoRecuperable(idx >= 0 ? historial[idx] : null, {
        esUltima: idx === historial.length - 1,
        tieneNivelacionViva: a.nivelacion === true || a.aprobadoNivelacion === true,
      })
      if (motivo) { rechazos.push(`${a.nombre || a._id}: ${motivo}`); continue }
      planes.push({ id: a._id, nombre: a.nombre, conteo: a.conteo, historial, idx })
    }
    if (rechazos.length) {
      throw new ConflictError(`No se recuperó ninguna. ${rechazos.join(' · ')}`)
    }

    for (const p of planes) {
      const entrada = p.historial[p.idx]
      const historial = p.historial.map((h, i) => (i === p.idx ? marcarRecuperada(h, actor, ahora) : h))
      await client.query(
        `UPDATE "ACADEMICA"
            SET "nivelacion" = true,
                "aprobadoNivelacion" = false,
                "detalleNivelacion" = $2::jsonb,
                "NivelacionCount" = $3,
                "NivelacionHistory" = $4::jsonb,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [
          p.id,
          JSON.stringify(detalleRecuperado(entrada, actor, ahora)),
          conteoAlRecuperar(p.conteo),
          JSON.stringify(historial),
        ]
      )
    }
    return planes.map(p => ({ academicaId: p.id, nombre: p.nombre }))
  })

  return successResponse({ recuperadas: usuarios.length, usuarios })
})
