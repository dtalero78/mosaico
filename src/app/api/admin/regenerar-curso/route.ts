import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { query } from '@/lib/postgres'
import { regenerarCursoPreservandoEstado } from '@/services/cursos-campaign-eventos.service'

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
            "inicioCurso"::text AS "inicioCurso", "finalCurso"::text AS "finalCurso", "numeroUsuarios", "grupoHorarioId"
     FROM "CURSOS_CAMPAIGN" WHERE "_id" = ANY($1)`, [ids]
  )).rows

  const resultado: any[] = []
  let totalEventos = 0
  let totalBookings = 0
  for (const c of cursos) {
    try {
      // `regenerarCursoPreservandoEstado` y NO `generarEventosCurso` a secas: el
      // segundo borra y recrea los eventos del curso, dejando HUÉRFANOS los
      // agendamientos de los alumnos. Este endpoint nació para cursos sin
      // alumnos, pero nada lo impedía sobre cursos con ellos — comprobado en
      // vivo: se perdieron 279 bookings de un curso con matrícula.
      const r = await regenerarCursoPreservandoEstado(c._id)
      totalEventos += r.eventos
      totalBookings += r.bookings
      resultado.push({
        curso: `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon}`,
        eventos: r.eventos, bookings: r.bookings, alumnos: r.alumnos,
        estadoReaplicado: r.estadoReaplicado, estadoSinMatch: r.estadoSinMatch,
      })
    } catch (e: any) {
      resultado.push({ curso: `${c.campaign} · ${c.tipoCurso} · Salón ${c.salon}`, error: e?.message || String(e) })
    }
  }
  return successResponse({ regenerados: resultado.filter(r => !r.error).length, totalEventos, totalBookings, resultado })
})
