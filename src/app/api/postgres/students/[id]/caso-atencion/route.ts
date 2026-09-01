import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { queryOne, withTransaction } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { ids } from '@/lib/id-generator'

/**
 * POST /api/postgres/students/[id]/caso-atencion   (id = ACADEMICA._id)
 * Body: { bookingId, comentario }
 *
 * Marca RESUELTO un Caso de Atención. Cierra las TRES cosas en una transacción:
 *  - el booking (ACADEMICA_BOOKINGS.casoAtencion=false),
 *  - el comentario en el historial del estudiante (ACADEMICA.historicCasoAtencion),
 *  - y el CASO del módulo (CASOS_ATENCION.estado='RESUELTO' = "Cerrado"), con su
 *    entrada en CASOS_ESTADO_HISTORIAL.
 *
 * Lo tercero se agregó porque sin ello el caso quedaba abierto en la ficha del
 * alumno aunque el informe lo diera por resuelto: eran dos verdades distintas
 * para el mismo caso. Si no hay caso enlazado (datos anteriores al módulo) sólo
 * se hacen los dos primeros pasos.
 *
 * Atómico. Gateado por SERVICIO.CASOS_ATENCION.GESTION.
 */
export const POST = handlerWithAuth(async (req, ctx, session) => {
  await requirePermission(session, ServicioPermission.CASOS_ATENCION_GESTION)

  const academicaId = decodeURIComponent(ctx.params.id || '').trim()
  const body = await req.json().catch(() => ({}))
  const bookingId = String(body?.bookingId || '').trim()
  const comentario = String(body?.comentario || '').trim()
  if (!academicaId) throw new ValidationError('academicaId requerido')
  if (!bookingId) throw new ValidationError('bookingId requerido')
  if (!comentario) throw new ValidationError('El comentario es obligatorio')

  // Datos del caso para el historial (curso, lección, fecha del evento, texto).
  const info = await queryOne<any>(
    `SELECT b."advisorAnotaciones" AS caso,
            ca."_id" AS "casoId", ca."estado"::text AS "estadoCaso",
            COALESCE(c."step", b."step") AS leccion,
            p."tipoCurso" AS curso,
            COALESCE(c."dia", b."fechaEvento") AS "fechaEvento"
       FROM "ACADEMICA_BOOKINGS" b
       LEFT JOIN "CALENDARIO" c ON c."_id" = COALESCE(b."eventoId", b."idEvento")
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(b."idEstudiante", b."studentId")
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN LATERAL (
         SELECT x."_id", x."estado" FROM "CASOS_ATENCION" x
          WHERE x."academicaId" = a."_id"
            AND x."eventoOrigenId" = COALESCE(b."eventoId", b."idEvento")
            AND x."estado" = 'EN_GESTION'
          ORDER BY x."_createdDate" DESC LIMIT 1
       ) ca ON true
      WHERE b."_id" = $1`,
    [bookingId]
  )
  if (!info) throw new NotFoundError('Booking', bookingId)

  const entry = {
    fecha: new Date().toISOString(),
    comentario,
    curso: info.curso || null,
    leccion: info.leccion || null,
    caso: info.caso || null,
    fechaEvento: info.fechaEvento ? new Date(info.fechaEvento).toISOString() : null,
    resueltoPor: session?.user?.email || null,
    resueltoPorNombre: (session?.user as any)?.name || null,
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE "ACADEMICA_BOOKINGS" SET "casoAtencion" = false, "_updatedDate" = NOW() WHERE "_id" = $1`,
      [bookingId]
    )
    await client.query(
      `UPDATE "ACADEMICA"
          SET "historicCasoAtencion" = COALESCE("historicCasoAtencion", '[]'::jsonb) || $2::jsonb,
              "_updatedDate" = NOW()
        WHERE "_id" = $1`,
      [academicaId, JSON.stringify([entry])]
    )
    // El caso del módulo pasa a "Cerrado". Sin esto quedaba abierto en la ficha
    // del alumno pese a estar resuelto en el informe.
    if (info.casoId) {
      await client.query(
        `UPDATE "CASOS_ATENCION"
            SET "estado" = 'RESUELTO', "cerradoPor" = $2, "cerradoEn" = NOW(), "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [info.casoId, session?.user?.email || null]
      )
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,$3,'RESUELTO',$4,$5,$6)`,
        [ids.comment(), info.casoId, info.estadoCaso || 'EN_GESTION',
         session?.user?.email || null, (session?.user as any)?.name || null, comentario]
      )
    }
  })

  return successResponse({ ok: true, casoCerrado: !!info.casoId })
})
