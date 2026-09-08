import 'server-only'
import crypto from 'crypto'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ValidationError } from '@/lib/errors'
import { query, queryOne } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/grupo-borrador
 *
 * Arma un grupo de nivelación SIN crear todavía el evento. El grupo queda en
 * Agrupaciones hasta que se confirme (ver `gestion-grupo`), de modo que se pueda
 * esperar a que lleguen más solicitudes y sumarlas al mismo grupo.
 *
 * POR QUÉ UN BORRADOR: antes "agrupar" creaba el evento y mandaba a los alumnos a
 * Pendientes en el mismo acto, así que un grupo quedaba cerrado desde el primer
 * alumno: si al día siguiente llegaba otro de la misma lección, había que crearle
 * otra sesión aparte. El borrador separa "quiénes van juntos" de "cuándo se dicta".
 *
 * DÓNDE VIVE: en `detalleNivelacion.grupoId` (el JSONB que ya guarda lección, hora
 * y motivo). No hace falta tabla ni columna nueva, y hereda la propiedad de que
 * nace y muere con la nivelación: al cerrarla, el borrador desaparece con ella.
 *
 * El grupo NO exige que todos compartan lección: el pre-agrupado por (curso,
 * lección) sigue siendo la sugerencia, pero Servicio puede sumar a mano a alguien
 * de otra lección cuando convenga dictarlas juntas.
 *
 * Acciones:
 *   agregar  { academicaIds, grupoId? }  grupoId ausente => se crea un grupo nuevo
 *   quitar   { academicaIds }            saca a los alumnos de su grupo
 */

const MAX_ALUMNOS = 60

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION as any)

  const body = await request.json()
  const accion = String(body?.accion || '').trim()
  const academicaIds: string[] = Array.isArray(body?.academicaIds)
    ? body.academicaIds.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : []

  if (accion !== 'agregar' && accion !== 'quitar') {
    throw new ValidationError('accion debe ser "agregar" o "quitar"')
  }
  if (!academicaIds.length) throw new ValidationError('Selecciona al menos un usuario')
  if (academicaIds.length > MAX_ALUMNOS) {
    throw new ValidationError(`Máximo ${MAX_ALUMNOS} usuarios por operación`)
  }

  // Sólo se puede agrupar lo que está aprobado y todavía no tiene evento; si ya
  // pasó a Pendientes, moverlo de grupo aquí dejaría el agendamiento desalineado.
  const vivos = (await query<{ _id: string; nombre: string }>(
    `SELECT a."_id", TRIM(CONCAT_WS(' ', a."primerNombre", a."primerApellido")) AS nombre
       FROM "ACADEMICA" a
      WHERE a."_id" = ANY($1::text[]) AND a."aprobadoNivelacion" = true`,
    [academicaIds]
  )).rows
  if (vivos.length !== academicaIds.length) {
    throw new ValidationError('Alguno de los usuarios ya no tiene una nivelación aprobada por agrupar')
  }

  if (accion === 'quitar') {
    await query(
      `UPDATE "ACADEMICA"
          SET "detalleNivelacion" = COALESCE("detalleNivelacion", '{}'::jsonb) - 'grupoId',
              "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[])`,
      [academicaIds]
    )
    return successResponse({ accion, grupoId: null, afectados: academicaIds.length })
  }

  // agregar ─ a un grupo existente o a uno nuevo
  let grupoId = typeof body?.grupoId === 'string' ? body.grupoId.trim() : ''
  if (grupoId) {
    // El grupo debe existir y seguir sin agendar: sumarse a uno ya confirmado
    // dejaría al alumno en un grupo cuyo evento ya se creó, sin estar inscrito.
    const existe = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "ACADEMICA"
        WHERE "aprobadoNivelacion" = true AND "detalleNivelacion"->>'grupoId' = $1`,
      [grupoId]
    )
    if (!existe || existe.n === 0) throw new ValidationError('El grupo indicado ya no existe')
  } else {
    grupoId = crypto.randomUUID()
  }

  await query(
    `UPDATE "ACADEMICA"
        SET "detalleNivelacion" = jsonb_set(
              COALESCE("detalleNivelacion", '{}'::jsonb), '{grupoId}', to_jsonb($2::text), true),
            "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[])`,
    [academicaIds, grupoId]
  )

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ACADEMICA"
      WHERE "aprobadoNivelacion" = true AND "detalleNivelacion"->>'grupoId' = $1`,
    [grupoId]
  )

  return successResponse({
    accion,
    grupoId,
    afectados: academicaIds.length,
    totalEnGrupo: total?.n ?? academicaIds.length,
  })
})
