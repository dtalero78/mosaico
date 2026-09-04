import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { query } from '@/lib/postgres'
import { ServicioPermission } from '@/types/permissions'
import { condicionUsuarioSql, exprNombreCompleto } from '@/lib/filtro-usuario'

/**
 * GET /api/postgres/reports/servicio/nivelaciones/pendientes?curso&leccion&guia
 *
 * Nivelaciones ya AGRUPADAS: aprobadas y con su evento creado, esperando que se
 * dicte y que el guía marque asistencia. Al cerrarse pasan al Histórico.
 *
 * Es el complemento exacto de Agrupaciones sobre el mismo universo
 * (`aprobadoNivelacion = true`): allí están las que todavía no tienen evento,
 * aquí las que ya lo tienen. La partición se DERIVA del agendamiento, no de una
 * bandera, para que borrar el evento o cancelar el agendamiento devuelva al
 * alumno a Agrupaciones sin que nadie tenga que acordarse de corregir un campo.
 *
 * Se distingue el evento que **ya pasó** y sigue sin cerrarse: ésa es la
 * nivelación que le falta gestionar al guía, y es lo que hay que poder ver.
 */
const MAX_ROWS = 5000

interface EventoNiv {
  eventoId: string
  eventoDia: string | null
  modulo: string | null
  leccion: string | null
  guia: string | null
}

/**
 * Para cada alumno, su nivelación agendada (la más próxima si tuviera varias).
 *
 * Se resuelve en DOS consultas cortas y se cruza en memoria, en vez de con un
 * LATERAL por alumno: partir de los ~165k agendamientos costaba segundos. Los
 * eventos de nivelación son un puñado, así que se listan primero y se pasan
 * como arreglo — con `= ANY($1)` en cada columna y un OR explícito, Postgres
 * combina los dos índices (BitmapOr), el mismo patrón que usa
 * `booking.repository`. `idEstudiante` y `studentId` se miran ambos porque el
 * enlace legacy de Wix usa el segundo.
 */
async function nivelacionesAgendadas(): Promise<Map<string, EventoNiv>> {
  const eventos = (await query<any>(
    `SELECT c."_id", c."dia", c."nivel", c."step", g."nombreCompleto" AS guia
       FROM "CALENDARIO" c
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE UPPER(COALESCE(c."tipo", '')) = 'NIVELACION'`
  )).rows
  const mapa = new Map<string, EventoNiv>()
  if (!eventos.length) return mapa
  const porEvento = new Map<string, any>(eventos.map((e: any) => [e._id, e]))

  const filas = (await query<any>(
    `SELECT DISTINCT b."idEstudiante", b."studentId", b."eventoId", b."idEvento"
       FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
        AND b."cancelo" IS NOT TRUE`,
    [Array.from(porEvento.keys())]
  )).rows

  for (const f of filas) {
    const ev = porEvento.get(f.eventoId) || porEvento.get(f.idEvento)
    if (!ev) continue
    const dato: EventoNiv = {
      eventoId: ev._id,
      eventoDia: ev.dia ? new Date(ev.dia).toISOString() : null,
      modulo: ev.nivel ?? null,
      leccion: ev.step ?? null,
      guia: ev.guia ?? null,
    }
    for (const id of [f.idEstudiante, f.studentId]) {
      if (!id) continue
      const previo = mapa.get(id)
      // Si el alumno tuviera más de una, manda la más próxima en el tiempo.
      if (!previo || (dato.eventoDia && previo.eventoDia && dato.eventoDia < previo.eventoDia)) {
        mapa.set(id, dato)
      }
    }
  }
  return mapa
}

export const GET = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_VER)

  const { searchParams } = new URL(request.url)
  const curso = (searchParams.get('curso') || '').trim()
  const leccion = (searchParams.get('leccion') || '').trim()
  const guia = (searchParams.get('guia') || '').trim()
  const usuario = (searchParams.get('usuario') || '').trim()

  const agendadas = await nivelacionesAgendadas()
  const ids = Array.from(agendadas.keys())
  if (!ids.length) {
    return successResponse({ rows: [], total: 0, cursos: [], lecciones: [], guias: [] })
  }

  const where: string[] = [
    `a."aprobadoNivelacion" = true`,
    `COALESCE(p."contrato",'') NOT LIKE 'PRB-%'`,
    `a."_id" = ANY($1::text[])`,
  ]
  const params: any[] = [ids]
  let i = 2
  if (curso) { where.push(`p."tipoCurso" = $${i++}`); params.push(curso) }
  if (guia)  { where.push(`cc."guia" = $${i++}`); params.push(guia) }
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
            g."nombreCompleto" AS "guiaCurso",
            COALESCE(a."NivelacionCount", 0)::int AS conteo
       FROM "ACADEMICA" a
       JOIN "PEOPLE" p ON p."_id" = a."peopleId"
       LEFT JOIN "CURSOS_CAMPAIGN" cc
         ON cc."campaign" = p."campaign" AND cc."tipoCurso" = p."tipoCurso" AND cc."horarioCurso" = p."horarioCurso"
       LEFT JOIN "GUIAS" g ON g."_id" = cc."guia"
      WHERE ${where.join(' AND ')}
      LIMIT ${MAX_ROWS}`,
    params
  )).rows

  // El tema se busca aparte porque la lección buena es la del EVENTO, que sólo
  // se conoce después de cruzar en memoria.
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

  const ahora = new Date().toISOString()
  let rows = base.map((r: any) => {
    const ev = agendadas.get(r.academicaId)
    const lec = ev?.leccion || r.leccionSolicitud || null
    return {
      academicaId: r.academicaId,
      curso: r.curso,
      nombre: r.nombre,
      numeroId: r.numeroId,
      fechaSolicitud: r.fechaSolicitud || null,
      confirmadoEn: r.confirmadoEn || null,
      confirmadoPor: r.confirmadoPor || null,
      salon: r.salon,
      modulo: ev?.modulo || r.moduloSolicitud || null,
      leccion: lec,
      tema: (r.curso && lec) ? (temas.get(`${r.curso}||${lec}`) ?? null) : null,
      guia: ev?.guia || r.guiaCurso || null,
      guiaId: r.guiaId,
      conteo: r.conteo,
      eventoId: ev?.eventoId || null,
      eventoDia: ev?.eventoDia || null,
      yaPaso: !!(ev?.eventoDia && ev.eventoDia < ahora),
    }
  })

  // La lección se filtra aquí y no en SQL porque la que vale es la del evento.
  if (leccion) rows = rows.filter((r) => (r.leccion || '') === leccion)
  rows.sort((a, b) =>
    String(a.eventoDia || '').localeCompare(String(b.eventoDia || ''))
    || String(a.curso || '').localeCompare(String(b.curso || ''))
    || String(a.nombre || '').localeCompare(String(b.nombre || '')))

  // Catálogos sobre el universo de la pestaña (sin los filtros aplicados), para
  // poder volver a ampliar la consulta después de acotarla.
  const todas = base.map((r: any) => {
    const ev = agendadas.get(r.academicaId)
    return { curso: r.curso, leccion: ev?.leccion || r.leccionSolicitud, guiaId: r.guiaId, guiaNombre: ev?.guia || r.guiaCurso }
  })
  const uniq = (arr: any[]) => Array.from(new Set(arr.filter(Boolean))).sort()
  const cursos = uniq(todas.map((o) => o.curso))
  const lecciones = uniq(todas.map((o) => o.leccion))
  const guias = Array.from(
    new Map(todas.filter((o) => o.guiaId).map((o) => [o.guiaId, { id: o.guiaId, nombre: o.guiaNombre }])).values()
  )

  return successResponse({ rows, total: rows.length, cursos, lecciones, guias })
})
