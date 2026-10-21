import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { withTransaction } from '@/lib/postgres'
import { ValidationError, ConflictError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import {
  MAX_DEVOLUCION, motivoNoDevolvible, detalleDevuelto, marcarDevuelta, conteoAlDevolver,
  type EntradaDevolvible,
} from '@/lib/nivelacion-devolucion'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/devolver-pendiente
 * Body: { items: [{ academicaId, fecha }] }   — `fecha` = la de la entrada del histórico
 *
 * Devuelve a **Pendientes** nivelaciones cerradas como «No asistió» (la regla está
 * en `lib/nivelacion-devolucion`): vuelven aprobadas y con su evento, esperando
 * que se dicten. El agendamiento no se toca; la entrada del histórico se conserva
 * marcada como devuelta.
 *
 * Todo el lote va en UNA transacción y con las filas bloqueadas (`FOR UPDATE`):
 * si una no se puede devolver no se devuelve ninguna, y el mensaje dice cuál.
 *
 * Permiso propio (`NIVELACIONES_DEVOLVER_PENDIENTE`) además de la gestión: es
 * deshacer un cierre, no una acción de rutina.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)
  await requirePermission(session, ServicioPermission.NIVELACIONES_DEVOLVER_PENDIENTE as any)

  const body = await request.json().catch(() => ({}))
  const items: { academicaId: string; fecha: string }[] = (Array.isArray(body?.items) ? body.items : [])
    .map((x: any) => ({ academicaId: String(x?.academicaId || '').trim(), fecha: String(x?.fecha || '').trim() }))
    .filter((x: any) => x.academicaId && x.fecha)

  if (!items.length) throw new ValidationError('Selecciona al menos una nivelación')
  if (items.length > MAX_DEVOLUCION) throw new ValidationError(`Máximo ${MAX_DEVOLUCION} nivelaciones por operación`)
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
    const planes: {
      id: string; nombre: string; conteo: number; historial: EntradaDevolvible[]; idx: number; agendadoEn: any
    }[] = []
    for (const it of items) {
      const a = porId.get(it.academicaId)
      if (!a) { rechazos.push(`${it.academicaId}: el usuario ya no existe`); continue }
      const historial: EntradaDevolvible[] = Array.isArray(a.historial) ? a.historial : []
      const idx = historial.findIndex(h => String(h?.fecha || '') === it.fecha)
      const motivo = motivoNoDevolvible(idx >= 0 ? historial[idx] : null, {
        esUltima: idx === historial.length - 1,
        tieneNivelacionViva: a.nivelacion === true || a.aprobadoNivelacion === true,
      })
      if (motivo) { rechazos.push(`${a.nombre || a._id}: ${motivo}`); continue }

      // El agendamiento vivo de ESA nivelación: el del evento más cercano a la
      // fecha en que se dictaría. Sin él, Pendientes no podría mostrarla.
      const fechaEvento = historial[idx].fechaEvento || null
      const bk = (await client.query(
        `SELECT b."_createdDate" AS "creadoEn"
           FROM "ACADEMICA_BOOKINGS" b
           JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
          WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
            AND UPPER(c."tipo") = 'NIVELACION'
            AND b."cancelo" IS NOT TRUE
            AND ($2::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (c."dia" - $2::timestamptz))) < 86400)
          ORDER BY CASE WHEN $2::timestamptz IS NULL THEN 0
                        ELSE ABS(EXTRACT(EPOCH FROM (c."dia" - $2::timestamptz))) END,
                   c."dia" DESC
          LIMIT 1`,
        [a._id, fechaEvento]
      )).rows[0]
      if (!bk) { rechazos.push(`${a.nombre || a._id}: ya no tiene el agendamiento de esa nivelación`); continue }

      planes.push({ id: a._id, nombre: a.nombre, conteo: a.conteo, historial, idx, agendadoEn: bk.creadoEn })
    }
    if (rechazos.length) {
      throw new ConflictError(`No se devolvió ninguna. ${rechazos.join(' · ')}`)
    }

    for (const p of planes) {
      const entrada = p.historial[p.idx]
      const historial = p.historial.map((h, i) => (i === p.idx ? marcarDevuelta(h, actor, ahora) : h))
      await client.query(
        `UPDATE "ACADEMICA"
            SET "nivelacion" = false,
                "aprobadoNivelacion" = true,
                "detalleNivelacion" = $2::jsonb,
                "NivelacionCount" = $3,
                "NivelacionHistory" = $4::jsonb,
                "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [
          p.id,
          JSON.stringify(detalleDevuelto(entrada, p.agendadoEn, actor, ahora)),
          conteoAlDevolver(entrada.resultado, p.conteo),
          JSON.stringify(historial),
        ]
      )
    }
    return planes.map(p => ({ academicaId: p.id, nombre: p.nombre }))
  })

  return successResponse({ devueltas: usuarios.length, usuarios })
})
