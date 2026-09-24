import 'server-only'
import { query } from '@/lib/postgres'
import { elegirAgendamientoActual } from '@/lib/nivelacion-agendamiento'

/**
 * El agendamiento de la nivelación ACTUAL de cada alumno.
 *
 * Es la única fuente para decidir "ya tiene evento" en Agrupaciones, Pendientes,
 * el cron de cancelación y el plazo de confirmación del panel del alumno. La regla
 * (sólo cuenta el agendamiento creado después de la solicitud) vive en
 * `lib/nivelacion-agendamiento`; aquí sólo se traen las filas.
 *
 * Se resuelve en consultas cortas y se cruza en memoria, no con un LATERAL por
 * alumno: partir de los ~165k agendamientos costaba segundos. Los eventos de
 * nivelación son un puñado, así que se listan primero y se pasan como arreglo —
 * con `= ANY($1)` en cada columna y un OR explícito, Postgres combina los dos
 * índices (BitmapOr), el mismo patrón que usa `booking.repository`.
 * `idEstudiante` y `studentId` se miran ambos porque el enlace legacy de Wix usa
 * el segundo.
 */
export interface AgendamientoNivelacion {
  bookingId: string
  eventoId: string
  eventoDia: string | null
  modulo: string | null
  leccion: string | null
  guia: string | null
  sesionCerrada: boolean
  /** `ACADEMICA_BOOKINGS._createdDate`: con esto se distingue de qué nivelación es. */
  creadoEn: string | null
  cancelo?: boolean | null
}

interface EventoRow {
  _id: string
  dia: any
  nivel: string | null
  step: string | null
  sesionCerrada: boolean | null
  guia: string | null
}

function armar(b: { _id: string; _createdDate: any }, ev: EventoRow): AgendamientoNivelacion {
  return {
    bookingId: b._id,
    eventoId: ev._id,
    eventoDia: ev.dia ? new Date(ev.dia).toISOString() : null,
    modulo: ev.nivel ?? null,
    leccion: ev.step ?? null,
    guia: ev.guia ?? null,
    sesionCerrada: ev.sesionCerrada === true,
    creadoEn: b._createdDate ? new Date(b._createdDate).toISOString() : null,
  }
}

/**
 * Mapa `ACADEMICA._id → agendamiento` para TODAS las nivelaciones vivas (pedidas
 * o aprobadas). Quien no aparece en el mapa no tiene agendamiento de su
 * solicitud actual → está (o debe estar) en Agrupaciones.
 */
export async function agendamientosDeNivelacionActual(): Promise<Map<string, AgendamientoNivelacion>> {
  const mapa = new Map<string, AgendamientoNivelacion>()

  const solicitudes = (await query<{ _id: string; fecha: string | null }>(
    `SELECT "_id", "detalleNivelacion"->>'fecha' AS fecha
       FROM "ACADEMICA"
      WHERE "nivelacion" = true OR "aprobadoNivelacion" = true`
  )).rows
  if (!solicitudes.length) return mapa

  const eventos = (await query<EventoRow>(
    `SELECT c."_id", c."dia", c."nivel", c."step", c."sesionCerrada", g."nombreCompleto" AS guia
       FROM "CALENDARIO" c
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE UPPER(COALESCE(c."tipo", '')) = 'NIVELACION'`
  )).rows
  if (!eventos.length) return mapa
  const porEvento = new Map(eventos.map((e) => [e._id, e]))

  const filas = (await query<any>(
    `SELECT b."_id", b."idEstudiante", b."studentId", b."eventoId", b."idEvento", b."_createdDate"
       FROM "ACADEMICA_BOOKINGS" b
      WHERE (b."eventoId" = ANY($1::text[]) OR b."idEvento" = ANY($1::text[]))
        AND b."cancelo" IS NOT TRUE`,
    [Array.from(porEvento.keys())]
  )).rows

  const porAlumno = new Map<string, AgendamientoNivelacion[]>()
  for (const f of filas) {
    const ev = porEvento.get(f.eventoId) || porEvento.get(f.idEvento)
    if (!ev) continue
    const ag = armar(f, ev)
    for (const id of new Set([f.idEstudiante, f.studentId].filter(Boolean) as string[])) {
      const lista = porAlumno.get(id)
      if (lista) lista.push(ag); else porAlumno.set(id, [ag])
    }
  }

  for (const s of solicitudes) {
    const elegido = elegirAgendamientoActual(s.fecha, porAlumno.get(s._id) || [])
    if (elegido) mapa.set(s._id, elegido)
  }
  return mapa
}

/**
 * El agendamiento de la nivelación actual de UN alumno (panel del alumno).
 * `soloFuturos` conserva el criterio que ya usaba el plazo de confirmación: se
 * cuenta desde un horario que todavía no llega.
 */
export async function agendamientoDeNivelacionActualDe(
  academicaId: string,
  fechaSolicitud: string | Date | null | undefined,
  opts: { soloFuturos?: boolean } = {}
): Promise<AgendamientoNivelacion | null> {
  const rows = (await query<any>(
    `SELECT b."_id", b."_createdDate",
            c."_id" AS "evId", c."dia", c."nivel", c."step", c."sesionCerrada", g."nombreCompleto" AS guia
       FROM "ACADEMICA_BOOKINGS" b
       JOIN "CALENDARIO" c ON (c."_id" = b."eventoId" OR c."_id" = b."idEvento")
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE (b."idEstudiante" = $1 OR b."studentId" = $1)
        AND b."cancelo" IS NOT TRUE
        AND UPPER(COALESCE(c."tipo", '')) = 'NIVELACION'
        ${opts.soloFuturos ? 'AND c."dia" > NOW()' : ''}`,
    [academicaId]
  )).rows
  return elegirAgendamientoActual(
    fechaSolicitud,
    rows.map((r) => armar(r, { _id: r.evId, dia: r.dia, nivel: r.nivel, step: r.step, sesionCerrada: r.sesionCerrada, guia: r.guia }))
  )
}
