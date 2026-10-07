import 'server-only'
import { query, queryOne } from '@/lib/postgres'
import { NotFoundError } from '@/lib/errors'
import { usaApoderadoAsync } from '@/services/tipos-curso.service'

/**
 * Envío de Mensajes › "Por evento": los eventos de un día y los inscritos de uno.
 *
 * A quién le llega: la MISMA regla del mensaje de bienvenida
 * (`lib/destino-bienvenida`) — en los cursos que usan apoderado (catálogo de
 * Tipos de Curso: YOJI/OKINA/KODOMO/DANSHI) al apoderado; en los demás al alumno;
 * y si el apoderado no tiene un teléfono utilizable, al alumno antes que a nadie.
 * Aquí se resuelve en lote (una consulta por evento) en vez de una por persona.
 */

export type FiltroAsistencia = 'todos' | 'asistieron' | 'no-asistieron'

const TZ_OK = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/
const tzSegura = (tz?: string | null) => (tz && TZ_OK.test(tz) ? tz : 'America/Santiago')

/** Una línea por evento del día (en la zona del navegador), con sus inscritos vivos. */
export async function eventosDelDia(fecha: string, tipo: string, tz?: string | null) {
  const zona = tzSegura(tz)
  const params: any[] = [fecha, zona]
  let filtroTipo = ''
  if (tipo) { params.push(tipo); filtroTipo = `AND UPPER(c."tipo") = UPPER($3)` }
  const { rows } = await query<any>(
    `SELECT c."_id", c."tipo", c."dia", c."tituloONivel", c."nombreEvento", c."curso", c."salon",
            c."duracionMin", g."nombreCompleto" AS guia,
            TO_CHAR(c."dia" AT TIME ZONE $2, 'HH24:MI') AS hora,
            (SELECT COUNT(*)::int FROM "ACADEMICA_BOOKINGS" b
              WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id")
                AND COALESCE(b."cancelo", false) = false) AS inscritos
       FROM "CALENDARIO" c
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE (c."dia" AT TIME ZONE $2)::date = $1::date
        ${filtroTipo}
      ORDER BY c."dia", c."tituloONivel"`,
    params
  )
  return rows
}

/** El evento suelto (para abrir la pantalla con él ya elegido desde el calendario). */
export async function eventoPorId(eventoId: string, tz?: string | null) {
  const ev = await queryOne<any>(
    `SELECT c."_id", c."tipo", c."dia", c."tituloONivel",
            TO_CHAR(c."dia" AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha
       FROM "CALENDARIO" c WHERE c."_id" = $1`,
    [eventoId, tzSegura(tz)]
  )
  if (!ev) throw new NotFoundError('Evento', eventoId)
  return ev
}

const digitos = (s?: string | null) => String(s || '').replace(/\D/g, '')

/**
 * Inscritos del evento en el formato de la lista de Envío de Mensajes
 * (mismo que `lookup-apoderados`): `celular` es el DESTINO ya resuelto.
 */
export async function destinatariosDeEvento(eventoId: string, asistencia: FiltroAsistencia) {
  const ev = await queryOne<any>(`SELECT "_id", "dia" FROM "CALENDARIO" WHERE "_id" = $1`, [eventoId])
  if (!ev) throw new NotFoundError('Evento', eventoId)

  const asistio = `(COALESCE(bk."asistio", false) OR COALESCE(bk."asistencia", false))`
  const filtro = asistencia === 'asistieron' ? `AND ${asistio}`
    : asistencia === 'no-asistieron' ? `AND NOT ${asistio}` : ''

  const { rows } = await query<any>(
    `SELECT a."_id" AS "academicaId", p."_id" AS "peopleId",
            COALESCE(p."numeroId", a."numeroId") AS "numeroId",
            p."primerNombre", p."primerApellido", p."celular",
            p."apoderado", p."apoderadoTelefono",
            p."campaign", p."tipoCurso", p."salon", p."plataforma", p."contrato",
            a."nivel", a."step", p."estadoInactivo",
            ${asistio} AS asistio
       FROM "ACADEMICA_BOOKINGS" bk
       JOIN "ACADEMICA" a ON a."_id" = COALESCE(bk."idEstudiante", bk."studentId")
       JOIN LATERAL (
         SELECT pp.* FROM "PEOPLE" pp
          WHERE pp."_id" = a."peopleId"
             OR (a."peopleId" IS NULL AND UPPER(TRIM(pp."numeroId")) = UPPER(TRIM(a."numeroId")))
          ORDER BY CASE WHEN pp."_id" = a."peopleId" THEN 0 ELSE 1 END,
                   CASE WHEN pp."tipoUsuario" = 'BENEFICIARIO' THEN 0 ELSE 1 END
          LIMIT 1
       ) p ON true
      WHERE (bk."eventoId" = $1 OR bk."idEvento" = $1)
        AND COALESCE(bk."cancelo", false) = false
        ${filtro}
      ORDER BY p."primerApellido", p."primerNombre"`,
    [eventoId]
  )

  // La regla de apoderado vive en el catálogo de Tipos de Curso: se consulta una
  // vez por curso, no por persona.
  const cursos = Array.from(new Set(rows.map(r => String(r.tipoCurso || ''))))
  const usaApo = new Map<string, boolean>()
  for (const c of cursos) usaApo.set(c, c ? await usaApoderadoAsync(c) : false)

  const vistos = new Set<string>()
  const items = []
  for (const r of rows) {
    const clave = r.numeroId || r.academicaId
    if (vistos.has(clave)) continue   // el mismo alumno agendado dos veces: un mensaje
    vistos.add(clave)
    const apo = digitos(r.apoderadoTelefono)
    const alAapoderado = !!usaApo.get(String(r.tipoCurso || '')) && apo.length >= 10
    const tel = alAapoderado ? apo : digitos(r.celular)
    const valido = tel.length >= 10
    items.push({
      numeroIdOriginal: r.numeroId || '',
      numeroId: clave,
      valido,
      error: valido ? undefined : 'Sin teléfono válido',
      academicaId: r.academicaId,
      peopleId: r.peopleId ?? null,
      nombre: r.primerNombre ?? null,
      primerApellido: r.primerApellido ?? null,
      celular: tel || null,
      apoderado: alAapoderado ? (r.apoderado || null) : null,
      esApoderado: alAapoderado,
      campaign: r.campaign ?? null,
      curso: r.tipoCurso ?? null,
      salon: r.salon ?? null,
      plataforma: r.plataforma ?? null,
      contrato: r.contrato ?? null,
      nivel: r.nivel ?? null,
      step: r.step ?? null,
      estadoInactivo: r.estadoInactivo ?? null,
      asistio: !!r.asistio,
    })
  }
  return { items, eventoPasado: new Date(ev.dia).getTime() <= Date.now() }
}
