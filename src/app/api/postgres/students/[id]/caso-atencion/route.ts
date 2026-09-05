import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { queryOne, withTransaction } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { ValidationError, NotFoundError } from '@/lib/errors'
import { ids } from '@/lib/id-generator'
import {
  ESTADOS_CIERRE, ESTADO_LABEL, ESTADO_AL_ASIGNAR, AREA_LABEL,
  type EstadoCaso, type AreaCaso, AREAS,
} from '@/lib/casos-atencion-estados'

/**
 * POST /api/postgres/students/[id]/caso-atencion   (id = ACADEMICA._id)
 * Body: { bookingId, comentario, estado? }
 *
 * ASIGNA el caso a un área. `estado` dice a cuál (por defecto RESUELTO =
 * "Cerrado", que es lo que hacía el botón cuando se llamaba Resolver).
 * Todos los estados admitidos CIERRAN el caso para Servicio y lo mandan a la
 * bandeja del área correspondiente; "Cerrar" no lo manda a ninguna.
 *
 * Cierra las TRES cosas en una transacción:
 *  - el booking (ACADEMICA_BOOKINGS.casoAtencion=false),
 *  - el comentario en el historial del estudiante (ACADEMICA.historicCasoAtencion),
 *  - y el CASO del módulo (CASOS_ATENCION.estado = el elegido), con su entrada
 *    en CASOS_ESTADO_HISTORIAL.
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
  // El modal manda el ÁREA; "Cerrar" no manda ninguna y sólo cierra el caso.
  const area = (String(body?.area || '').trim() || null) as AreaCaso | null
  if (area && !AREAS.includes(area)) throw new ValidationError(`Área no válida: ${area}`)
  const estado: EstadoCaso = area ? ESTADO_AL_ASIGNAR[area] : 'RESUELTO'
  if (!academicaId) throw new ValidationError('academicaId requerido')
  if (!bookingId) throw new ValidationError('bookingId requerido')
  // Sólo estados de cierre: asignar a un área saca el caso de la bandeja.
  // El comentario se exige al CERRAR (hay que justificar por qué el caso no
  // requiere nada más) y al derivar a NIVELACIÓN, donde el texto ES el encargo:
  // qué hay que reforzarle al alumno. En las otras derivaciones es opcional,
  // porque la justificación la dará el área que lo reciba.
  if (!area && !comentario) throw new ValidationError('El comentario es obligatorio al cerrar el caso')
  if (area === 'NIVELACIONES' && !comentario) {
    throw new ValidationError('El detalle de la nivelación es obligatorio')
  }

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
    estado,
    estadoLabel: ESTADO_LABEL[estado] || estado,
    area,
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
            SET "estado" = $3::estado_caso, "area" = $4,
                "cerradoPor" = $2, "cerradoEn" = NOW(), "_updatedDate" = NOW()
          WHERE "_id" = $1`,
        [info.casoId, session?.user?.email || null, estado, area]
      )
      await client.query(
        `INSERT INTO "CASOS_ESTADO_HISTORIAL"("_id","casoId","estadoAnterior","estadoNuevo","autorEmail","autorNombre","motivo")
         VALUES ($1,$2,$3,$7::estado_caso,$4,$5,$6)`,
        [ids.comment(), info.casoId, info.estadoCaso || 'EN_GESTION',
         session?.user?.email || null, (session?.user as any)?.name || null,
         comentario || `Asignado a ${area ? AREA_LABEL[area] : 'Cerrado'}`, estado]
      )
    }
  })

  return successResponse({ ok: true, casoCerrado: !!info.casoId, estado, area })
})
