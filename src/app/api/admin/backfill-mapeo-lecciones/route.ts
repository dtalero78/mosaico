import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { ForbiddenError } from '@/lib/errors'
import { query } from '@/lib/postgres'
import { mapearLeccionesSalon } from '@/services/repetir-clase.service'

/**
 * POST /api/admin/backfill-mapeo-lecciones   (SUPER_ADMIN)
 * Body: { apply?: boolean }  — sin apply = dry-run (solo reporta cuántos faltan).
 *
 * Puebla el mapeo sesión→lección (`sesionModulo` / `sesionLeccion` / `leccionOrden`)
 * de todos los cursos de campaña activos, corriendo `mapearLeccionesSalon` por curso.
 * Es la base del nuevo "¿Cómo voy?" de MOSAICO: cada sesión (por fecha) recibe la
 * i-ésima lección del curso (secuencia de NIVELES por `orden`, con las repeticiones
 * de `historicRepet` insertadas). Idempotente — re-correr no duplica.
 *
 * NO crea ni borra eventos; solo escribe el mapeo en las columnas ya existentes.
 */
export const POST = handlerWithAuth(async (req, _ctx, session) => {
  if ((session.user as any)?.role !== 'SUPER_ADMIN') {
    throw new ForbiddenError('Solo SUPER_ADMIN puede correr el backfill de mapeo.')
  }
  const body = await req.json().catch(() => ({}))
  const apply = body?.apply === true

  const cursos = (await query(
    `SELECT cc."_id", cc."campaign", cc."tipoCurso", cc."salon",
            COUNT(c.*)::int AS eventos,
            COUNT(c."sesionLeccion")::int AS mapeados
       FROM "CURSOS_CAMPAIGN" cc
       LEFT JOIN "CALENDARIO" c ON c."cursoCampaignId" = cc."_id"
      WHERE cc."activa" = true
      GROUP BY cc."_id", cc."campaign", cc."tipoCurso", cc."salon"`
  )).rows

  const resumen: any[] = []
  let totalEventos = 0, totalMapeadosAntes = 0, totalMapeadosDespues = 0, cursosTocados = 0, errores = 0

  for (const cc of cursos) {
    totalEventos += cc.eventos
    totalMapeadosAntes += cc.mapeados
    const faltan = cc.eventos - cc.mapeados
    if (!apply) {
      if (faltan > 0) cursosTocados++
      resumen.push({ campaign: cc.campaign, curso: cc.tipoCurso, salon: cc.salon, eventos: cc.eventos, yaMapeados: cc.mapeados, faltan })
      continue
    }
    try {
      const n = await mapearLeccionesSalon(cc._id)
      const despues = (await query(
        `SELECT COUNT("sesionLeccion")::int AS m FROM "CALENDARIO" WHERE "cursoCampaignId" = $1`, [cc._id]
      )).rows[0]?.m ?? 0
      totalMapeadosDespues += despues
      if (despues > cc.mapeados) cursosTocados++
      resumen.push({ campaign: cc.campaign, curso: cc.tipoCurso, salon: cc.salon, eventos: cc.eventos, mapeados: despues, secuencia: n })
    } catch (e: any) {
      errores++
      resumen.push({ campaign: cc.campaign, curso: cc.tipoCurso, salon: cc.salon, error: e?.message || String(e) })
    }
  }

  return successResponse({
    apply,
    cursos: cursos.length,
    totalEventos,
    totalMapeadosAntes,
    totalMapeadosDespues: apply ? totalMapeadosDespues : undefined,
    cursosTocados,
    errores,
    resumen,
  })
})
