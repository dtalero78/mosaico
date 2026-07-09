import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { query, queryOne } from '@/lib/postgres'
import { AcademicaRepository } from '@/repositories/academica.repository'
import { NotFoundError } from '@/lib/errors'

/**
 * GET /api/postgres/students/[id]/nivelacion
 * Devuelve el estado de nivelación del estudiante (ACADEMICA):
 *   { nivelacion: boolean, detalleNivelacion: any }
 * [id] resuelve por _id/studentId/peopleId/numeroId (findByAnyId).
 */
export const GET = handlerWithAuth(async (_req, { params }, _session) => {
  const rec: any = await AcademicaRepository.findByAnyId(params.id)
  if (!rec?._id) throw new NotFoundError('ACADEMICA', params.id)
  const row = await queryOne<{ nivelacion: boolean | null; detalleNivelacion: any }>(
    `SELECT "nivelacion", "detalleNivelacion" FROM "ACADEMICA" WHERE "_id" = $1`,
    [rec._id]
  )
  return successResponse({
    nivelacion: row?.nivelacion ?? false,
    detalleNivelacion: row?.detalleNivelacion ?? null,
  })
})

/**
 * PATCH /api/postgres/students/[id]/nivelacion
 * Body: { nivelacion: boolean, leccion?: string, modulo?: string }
 * Marca ACADEMICA.nivelacion y guarda la lección seleccionada en
 * ACADEMICA.detalleNivelacion (jsonb: { leccion, modulo, fecha, marcadoPor }).
 * Al desmarcar (nivelacion=false) se limpia detalleNivelacion.
 */
export const PATCH = handlerWithAuth(async (request, { params }, session) => {
  const rec: any = await AcademicaRepository.findByAnyId(params.id)
  if (!rec?._id) throw new NotFoundError('ACADEMICA', params.id)

  const body = await request.json()
  const nivelacion = body?.nivelacion === true
  const leccion = (body?.leccion || '').trim() || null
  const modulo = (body?.modulo || '').trim() || null

  const detalle = nivelacion && leccion
    ? { leccion, modulo, fecha: new Date().toISOString(), marcadoPor: session.user?.email || null }
    : null

  await query(
    `UPDATE "ACADEMICA"
       SET "nivelacion" = $2, "detalleNivelacion" = $3::jsonb, "_updatedDate" = NOW()
     WHERE "_id" = $1`,
    [rec._id, nivelacion, detalle ? JSON.stringify(detalle) : null]
  )

  return successResponse({ nivelacion, detalleNivelacion: detalle })
})
