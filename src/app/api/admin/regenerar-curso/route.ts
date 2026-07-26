import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { query } from '@/lib/postgres'
import { generarEventosCurso } from '@/services/cursos-campaign-eventos.service'

/**
 * POST /api/admin/regenerar-curso   (SUPER_ADMIN)
 * Body: { cursoCampaignIds: string[] }
 *
 * Regenera los eventos de CALENDARIO de los cursos indicados (borra + recrea desde
 * su inicio/final/horario actuales, holiday-aware). Úsalo después de cambiar
 * campaña/inicio/final de un curso para que sus eventos reflejen los nuevos valores.
 * OJO: borra los bookings ligados a esos eventos — pensado para cursos SIN alumnos.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  if ((session.user as any)?.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Solo SUPER_ADMIN puede regenerar eventos de curso.')
  }
  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.cursoCampaignIds) ? body.cursoCampaignIds : []
  if (!ids.length) throw new ValidationError('cursoCampaignIds (array) es requerido.')

  const cursos = (await query(
    `SELECT "_id","campaign","tipoCurso","salon","guia","horarioCurso",
            "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso", "numeroUsuarios"
     FROM "CURSOS_CAMPAIGN" WHERE "_id" = ANY($1)`, [ids]
  )).rows

  const resultado: any[] = []
  let totalEventos = 0
  for (const c of cursos) {
    try {
      const n = await generarEventosCurso(c as any)
      totalEventos += n
      resultado.push({ curso: `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon}`, eventos: n })
    } catch (e: any) {
      resultado.push({ curso: `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon}`, error: e?.message || String(e) })
    }
  }
  return successResponse({ regenerados: resultado.filter(r => !r.error).length, totalEventos, resultado })
})
