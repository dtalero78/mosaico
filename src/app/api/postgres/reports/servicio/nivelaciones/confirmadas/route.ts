import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'
import { agendamientosDeNivelacionActual } from '@/services/nivelacion-agendada.service'
import { alcancePorGuia } from '@/services/guia-sesion.service'
import { alcanceSinResultados } from '@/lib/alcance-guia'

/**
 * GET /api/postgres/reports/servicio/nivelaciones/confirmadas?curso&leccion&guia&usuario
 *
 * Nivelaciones con evento agendado (aprobadas y ya agrupadas) que el USUARIO o
 * Servicio ya CONFIRMÓ (`detalleNivelacion.confirmadoEn`) y que aún no se cierran.
 * Es el mismo universo de Pendientes, sólo las confirmadas; al cerrarse pasan al
 * Histórico. Gateado por SERVICIO.NIVELACIONES.VER.
 *
 * Rol GUIA: sólo las de los alumnos de sus salones o las que él mismo pidió
 * (ver lib/alcance-guia). El filtro `guia` que llegue se ignora.
 */
const MAX_ROWS = 5000

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const usuario = (searchParams.get('usuario') || '').trim()

  const alcance = await alcancePorGuia(session, guia)
  if (alcanceSinResultados(alcance)) {
    return successResponse({ rows: [], total: 0, cursos: [], lecciones: [], guias: [], soloPropios: true })
  }

  const agendadas = await agendamientosDeNivelacionActual()
  const ids = Array.from(agendadas.keys())
  if (!ids.length) {
    return successResponse({ rows: [], total: 0, cursos: [], lecciones: [], guias: [], soloPropios: !!alcance.soloPropios })
  }

  const where: string[] = [
    `a."aprobadoNivelacion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    `a."_id" = ANY($1::text[])`,
  ]
  // `estado`: 'confirmadas' | 'sin' (sin confirmar) | vacío = todas las agendadas.
  const estado = (searchParams.get('estado') || '').trim()
  if (estado === 'confirmadas') where.push(`COALESCE(a."detalleNivelacion"->>'confirmadoEn','') <> ''`)
  else if (estado === 'sin') where.push(`COALESCE(a."detalleNivelacion"->>'confirmadoEn','') = ''`)
  const params: any[] = [ids]
  let i = 2
  if (alcance.soloPropios) {
    const email = String((session as any)?.user?.email || '').trim()
    where.push(`(cc."guia" = $${i} OR LOWER(TRIM(COALESCE(a."detalleNivelacion"->>'marcadoPor',''))) = LOWER(TRIM($${i + 1})))`)
    params.push(alcance.guiaId, email); i += 2
  } else if (alcance.guiaId) {
    where.push(`cc."guia" = $${i++}`); params.push(alcance.guiaId)
  }
  if (curso) { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (usuario) {
    const c = condicionUsuarioSql(exprNombreCompleto('p'), 'p."numeroId"', usuario, i)
    where.push(c.sql); params.push(...c.params); i += 2
  }

  const base = (await query<any>(
    `SELECT a."_id" AS "academicaId",
            p."tipoCurso" AS curso,
            TRIM(REGEXP_REPLACE(CONCAT_WS(' ', p."primerNombre", p."segundoNombre", p."primerApellido", p."segundoApellido"), '\\s+', ' ', 'g')) AS nombre,
            p."numeroId",
            p."salon",
            (a."detalleNivelacion"->>'fecha') AS "fechaSolicitud",
            (a."detalleNivelacion"->>'confirmadoEn') AS "confirmadoEn",
            (a."detalleNivelacion"->>'confirmadoPor') AS "confirmadoPor",
            (a."detalleNivelacion"->>'modulo') AS "moduloSolicitud",
            (a."detalleNivelacion"->>'leccion') AS "leccionSolicitud",
            cc."guia" AS "guiaId",
            g."nombreCompleto" AS "guiaCurso"
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso" AND cc."salon" IS NOT DISTINCT FROM p."salon"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${where.join(' AND ')}
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  const claveDe = (r: any) => {
    const lec = agendadas.get(r.academicaId)?.leccion || r.leccionSolicitud
    return r.curso && lec ? `${r.curso}||${lec}` : null
  }
  const temas = new Map<string, string>()
  const claves = Array.from(new Set(base.map(claveDe).filter(Boolean))) as string[]
  if (claves.length) {
    const filas = (await query<any>(
      `SELECT n."curso", n."step", n."description"
         FROM "NIVELES" n
        WHERE (n."curso" || '||' || n."step") = ANY($1::text[])`,
      [claves]
    )).rows
    for (const f of filas) temas.set(`${f.curso}||${f.step}`, f.description)
  }

  let rows = base.map((r: any) => {
    const ev = agendadas.get(r.academicaId)
    const lec = ev?.leccion || r.leccionSolicitud || null
    return {
      academicaId: r.academicaId,
      curso: r.curso,
      nombre: r.nombre,
      numeroId: r.numeroId,
      salon: r.salon,
      fechaSolicitud: r.fechaSolicitud || null,
      confirmadoEn: r.confirmadoEn || null,
      confirmadoPor: r.confirmadoPor || null,
      modulo: ev?.modulo || r.moduloSolicitud || null,
      leccion: lec,
      tema: (r.curso && lec) ? (temas.get(`${r.curso}||${lec}`) ?? null) : null,
      guia: ev?.guia || r.guiaCurso || null,
      eventoId: ev?.eventoId || null,
      eventoDia: ev?.eventoDia || null,
    }
  })

  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean))).sort()
  // Catálogos sobre el universo (sin los filtros de lección), para poder ampliar.
  const cursos = uniq(rows.map((r) => r.curso))
  const lecciones = uniq(rows.map((r) => r.leccion))
  const guias = Array.from(
    new Map(base.filter((r: any) => r.guiaId).map((r: any) => [r.guiaId, { id: r.guiaId, nombre: agendadas.get(r.academicaId)?.guia || r.guiaCurso }])).values()
  )

  if (leccion) rows = rows.filter((r) => (r.leccion || '') === leccion)
  // Lo más próximo a dictarse primero.
  rows.sort((a, b) =>
    String(a.eventoDia || '9999').localeCompare(String(b.eventoDia || '9999'))
    || String(a.nombre || '').localeCompare(String(b.nombre || '')))

  return successResponse({ rows, total: rows.length, cursos, lecciones, guias, soloPropios: !!alcance.soloPropios })
})
