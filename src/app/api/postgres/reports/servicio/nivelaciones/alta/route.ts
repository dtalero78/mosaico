import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query, queryOne } from '@/lib/postgres'
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors'
import { ServicioPermission } from '@/types/permissions'
import { esHoraNivelacionValida } from '@/lib/nivelacion-confirmacion'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/alta
 * Body: { academicaId, guiaId, modulo, leccion }
 *
 * Adiciona una nivelación desde Servicio, sin pasar por el panel del guía.
 * Es el gemelo del alta de Casos de Atención y comparte su cascada de opciones
 * (`/api/postgres/casos-atencion/alta-opciones`).
 *
 * La nivelación queda **a nombre del GUÍA** —es su alumno y su clase— pero se
 * registra quién la tecleó (`registradoPor`): sin eso, una nivelación levantada
 * por Servicio sería indistinguible de una que pidió el propio guía.
 *
 * Dos guardas que no se pueden dejar al front:
 *  - el guía tiene que dictar REALMENTE el salón del alumno, o se estaría
 *    pidiendo una nivelación a nombre de alguien que no le da clase;
 *  - el alumno no puede tener otra nivelación viva (pedida o ya aprobada), o
 *    aparecería dos veces en el flujo y el conteo quedaría inflado.
 */
export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)

  const body = await request.json().catch(() => ({}))
  const academicaId = String(body?.academicaId || '').trim()
  const guiaId = String(body?.guiaId || '').trim()
  const modulo = String(body?.modulo || '').trim()
  const leccion = String(body?.leccion || '').trim()
  const hora = String(body?.hora || '').trim()
  const motivo = String(body?.motivo || '').trim()

  if (!academicaId) throw new ValidationError('Falta el usuario')
  if (!guiaId) throw new ValidationError('Falta el guía')
  if (!leccion) throw new ValidationError('Falta la lección')
  if (!esHoraNivelacionValida(hora)) throw new ValidationError('Elige una hora válida para la nivelación')
  if (!motivo) throw new ValidationError('Escribe el motivo de la nivelación')

  const alumno = await queryOne<any>(
    `SELECT a."_id", a."nivelacion", a."aprobadoNivelacion",
            COALESCE(a."NivelacionCount", 0)::int AS conteo,
            p."tipoCurso", p."salon", p."campaign", p."horarioCurso",
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."primerApellido"), '\\s+', ' ', 'g')) AS nombre
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE a."_id" = $1`,
    [academicaId]
  )
  if (!alumno) throw new NotFoundError('ACADEMICA', academicaId)

  if (alumno.nivelacion === true) {
    throw new ConflictError(`${alumno.nombre} ya tiene una nivelación solicitada sin resolver.`)
  }
  if (alumno.aprobadoNivelacion === true) {
    throw new ConflictError(`${alumno.nombre} ya tiene una nivelación aprobada pendiente de dictarse.`)
  }

  // El guía se comprueba contra el curso del alumno, no se confía en el que llegó.
  const guia = await queryOne<any>(
    `SELECT g."_id", g."email", g."nombreCompleto"
       FROM "GUIAS" g
      WHERE g."_id" = $1
        AND EXISTS (SELECT 1 FROM "CURSOS_CAMPAIGN" cc
                     WHERE cc."guia" = g."_id" AND cc."activa" = true
                       AND cc."tipoCurso" = $2 AND cc."campaign" = $3 AND cc."horarioCurso" = $4)`,
    [guiaId, alumno.tipoCurso, alumno.campaign, alumno.horarioCurso]
  )
  if (!guia) throw new ValidationError('El guía seleccionado no dicta el salón de ese usuario.')

  const detalle = {
    leccion,
    modulo: modulo || null,
    hora,
    motivo,
    fecha: new Date().toISOString(),
    marcadoPor: guia.email || null,
    registradoPor: session.user?.name || null,
    registradoPorEmail: session.user?.email || null,
  }

  await query(
    `UPDATE "ACADEMICA"
        SET "nivelacion" = true,
            "detalleNivelacion" = $2::jsonb,
            "NivelacionCount" = $3,
            "_updatedDate" = NOW()
      WHERE "_id" = $1`,
    [academicaId, JSON.stringify(detalle), alumno.conteo + 1]
  )

  return successResponse({
    academicaId,
    nombre: alumno.nombre,
    guia: guia.nombreCompleto,
    detalleNivelacion: detalle,
    NivelacionCount: alumno.conteo + 1,
  })
})
