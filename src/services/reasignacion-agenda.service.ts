import 'server-only'
import { query, transaction } from '@/lib/postgres'
import { ValidationError, NotFoundError, ConflictError } from '@/lib/errors'
import { enrollStudents } from '@/services/enrollment.service'
import { motivoFueraDeAlcance } from '@/lib/alcance-evento'

/**
 * Sacar a un alumno de una NIVELACIÓN o de un TALLER, o trasladarlo a otro del
 * mismo tipo (Servicio › Nivelaciones › Pendientes y Servicio › Talleres › Gestión
 * usuario).
 *
 * "Sacar" = CANCELAR el agendamiento (`cancelo = true`, con quién, cuándo y por qué),
 * no borrar la fila: queda la huella y el contador de inscritos baja. En una
 * nivelación no hace falta tocar nada más: "Pendientes" se DERIVA de tener un
 * agendamiento vivo, así que el alumno vuelve solo a Agrupaciones (con la etiqueta
 * "Reasignar", que también se deriva del agendamiento cancelado).
 *
 * "Trasladar" = cancelar el agendamiento viejo y agendar en el destino con la MISMA
 * `enrollStudents` de siempre (cupo, cruce de horario, alumno inactivo…). Se cancela
 * PRIMERO para que un destino a la misma hora que el viejo no choque con él; si el
 * agendamiento nuevo falla, la cancelación se REVIERTE y no queda nada a medias.
 * La solicitud y la confirmación de la nivelación no se tocan.
 */
export type TipoAgenda = 'NIVELACION' | 'CLUB'
export interface ActorAgenda { email: string; nombre: string; rol?: string }

const MAX_ALUMNOS = 60

interface BookingRow {
  bookingId: string
  academicaId: string
  eventoId: string
  eventoDia: Date
  eventoTipo: string
  sesionCerrada: boolean | null
  nombre: string
  campaign: string | null
  curso: string | null
  salon: string | null
}

/** Los agendamientos vivos pedidos, con su evento y el alumno. Valida que todos sean del tipo. */
async function cargarBookings(bookingIds: string[], tipo: TipoAgenda): Promise<BookingRow[]> {
  const ids = Array.from(new Set(bookingIds.filter(Boolean)))
  if (!ids.length) throw new ValidationError('Selecciona al menos un alumno')
  if (ids.length > MAX_ALUMNOS) throw new ValidationError(`Máximo ${MAX_ALUMNOS} alumnos por operación`)
  const rows = (await query<any>(
    `SELECT bk."_id" AS "bookingId",
            COALESCE(bk."idEstudiante", bk."studentId") AS "academicaId",
            c."_id" AS "eventoId", c."dia" AS "eventoDia", UPPER(COALESCE(c."tipo", c."evento", '')) AS "eventoTipo",
            c."sesionCerrada",
            TRIM(CONCAT_WS(' ', COALESCE(p."primerNombre", a."primerNombre"), COALESCE(p."primerApellido", a."primerApellido"))) AS nombre,
            p."campaign", p."tipoCurso" AS curso, p."salon"
       FROM "ACADEMICA_BOOKINGS" bk
       JOIN "CALENDARIO" c ON c."_id" = COALESCE(bk."eventoId", bk."idEvento")
       LEFT JOIN "ACADEMICA" a ON a."_id" = COALESCE(bk."idEstudiante", bk."studentId")
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE bk."_id" = ANY($1::text[]) AND COALESCE(bk."cancelo", false) = false`,
    [ids]
  )).rows as BookingRow[]
  if (rows.length !== ids.length) {
    throw new ValidationError('Algún agendamiento ya no está vigente (se canceló o no existe). Recarga la lista.')
  }
  const ahora = Date.now()
  for (const r of rows) {
    if (r.eventoTipo !== tipo) throw new ValidationError(`${r.nombre}: su agendamiento no es de ${tipo === 'NIVELACION' ? 'una nivelación' : 'un taller'}.`)
    if (new Date(r.eventoDia).getTime() <= ahora) {
      throw new ValidationError(`${r.nombre}: la sesión ya empezó; si no se dictó, se gestiona desde el cierre, no desde aquí.`)
    }
    if (r.sesionCerrada === true) throw new ValidationError(`${r.nombre}: la sesión ya está cerrada.`)
  }
  return rows
}

const motivoLimpio = (m: unknown) => {
  const t = String(m ?? '').trim()
  if (!t) throw new ValidationError('El motivo es obligatorio')
  if (t.length > 500) throw new ValidationError('El motivo no puede pasar de 500 caracteres')
  return t
}

/** Marca como cancelados (con la huella) y descuenta el contador de cada evento. */
async function cancelar(rows: BookingRow[], motivo: string, actor: ActorAgenda, destinoId: string | null) {
  await transaction(async (client) => {
    const r = await client.query(
      `UPDATE "ACADEMICA_BOOKINGS"
          SET "cancelo" = true, "canceladoPor" = $2, "canceladoEn" = NOW(),
              "motivoCancelacion" = $3, "trasladadoAEvento" = $4, "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[]) AND COALESCE("cancelo", false) = false
        RETURNING "_id"`,
      [rows.map(x => x.bookingId), actor.email, motivo, destinoId]
    )
    if ((r.rowCount ?? 0) !== rows.length) throw new ConflictError('Otro usuario modificó esos agendamientos. Recarga la lista.')
    const porEvento = new Map<string, number>()
    for (const x of rows) porEvento.set(x.eventoId, (porEvento.get(x.eventoId) || 0) + 1)
    for (const [ev, n] of porEvento) {
      await client.query(
        `UPDATE "CALENDARIO" SET "inscritos" = GREATEST(COALESCE("inscritos",0) - $1, 0), "_updatedDate" = NOW() WHERE "_id" = $2`,
        [n, ev]
      )
    }
  })
}

/** Deshace `cancelar` (si el agendamiento en el destino falló). */
async function revertir(rows: BookingRow[]) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE "ACADEMICA_BOOKINGS"
          SET "cancelo" = false, "canceladoPor" = NULL, "canceladoEn" = NULL,
              "motivoCancelacion" = NULL, "trasladadoAEvento" = NULL, "_updatedDate" = NOW()
        WHERE "_id" = ANY($1::text[])`,
      [rows.map(x => x.bookingId)]
    )
    const porEvento = new Map<string, number>()
    for (const x of rows) porEvento.set(x.eventoId, (porEvento.get(x.eventoId) || 0) + 1)
    for (const [ev, n] of porEvento) {
      await client.query(`UPDATE "CALENDARIO" SET "inscritos" = COALESCE("inscritos",0) + $1, "_updatedDate" = NOW() WHERE "_id" = $2`, [n, ev])
    }
  })
}

export async function sacarDeEvento(input: { bookingIds: string[]; tipo: TipoAgenda; motivo: string; actor: ActorAgenda }) {
  const motivo = motivoLimpio(input.motivo)
  const rows = await cargarBookings(input.bookingIds, input.tipo)
  await cancelar(rows, motivo, input.actor, null)
  return { sacados: rows.length, nombres: rows.map(r => r.nombre) }
}

export interface DestinoAgenda {
  eventoId: string
  dia: string
  titulo: string
  guia: string | null
  inscritos: number
  cupo: number
  libres: number | null
  cabe: boolean
}

/** Eventos futuros del mismo tipo y del alcance de TODOS los alumnos, con su cupo. */
export async function destinosDisponibles(input: { bookingIds: string[]; tipo: TipoAgenda }): Promise<DestinoAgenda[]> {
  const rows = await cargarBookings(input.bookingIds, input.tipo)
  const origenes = new Set(rows.map(r => r.eventoId))
  const eventos = (await query<any>(
    `SELECT c."_id", c."dia", c."campaign", c."curso", c."salon", c."limiteUsuarios",
            COALESCE(NULLIF(c."tituloONivel", ''), c."nombreEvento") AS titulo,
            g."nombreCompleto" AS guia,
            (SELECT COUNT(*) FROM "ACADEMICA_BOOKINGS" b
              WHERE (b."eventoId" = c."_id" OR b."idEvento" = c."_id") AND COALESCE(b."cancelo", false) = false)::int AS vivos
       FROM "CALENDARIO" c
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE UPPER(COALESCE(c."tipo", c."evento", '')) = $1
        AND c."dia" > NOW() AND COALESCE(c."sesionCerrada", false) = false
      ORDER BY c."dia" ASC
      LIMIT 400`,
    [input.tipo]
  )).rows
  const salida: DestinoAgenda[] = []
  for (const e of eventos) {
    if (origenes.has(e._id)) continue
    // Mismo alcance que ve el alumno: curso (y en talleres también campaña y salón).
    const fuera = rows.some(r => input.tipo === 'NIVELACION'
      ? motivoFueraDeAlcance({ curso: e.curso }, { curso: r.curso }) !== null
      : motivoFueraDeAlcance({ campaign: e.campaign, curso: e.curso, salon: e.salon }, { campaign: r.campaign, curso: r.curso, salon: r.salon }) !== null)
    if (fuera) continue
    const cupo = Number(e.limiteUsuarios) || 0
    const libres = cupo > 0 ? Math.max(cupo - e.vivos, 0) : null
    salida.push({
      eventoId: e._id, dia: new Date(e.dia).toISOString(), titulo: e.titulo || '', guia: e.guia || null,
      inscritos: e.vivos, cupo, libres, cabe: libres === null || libres >= rows.length,
    })
  }
  return salida
}

export async function trasladarAEvento(input: {
  bookingIds: string[]; tipo: TipoAgenda; destinoEventoId: string; motivo: string; actor: ActorAgenda; cancelarCruces?: boolean
}) {
  const motivo = motivoLimpio(input.motivo)
  const rows = await cargarBookings(input.bookingIds, input.tipo)
  const destinos = await destinosDisponibles({ bookingIds: input.bookingIds, tipo: input.tipo })
  const destino = destinos.find(d => d.eventoId === input.destinoEventoId)
  if (!destino) throw new ValidationError('Ese evento no es un destino válido (otro tipo, otro curso, ya empezó o es el mismo).')
  if (!destino.cabe) throw new ValidationError(`El destino no tiene cupo para ${rows.length} alumno(s) (libres: ${destino.libres}).`)

  await cancelar(rows, motivo, input.actor, destino.eventoId)
  try {
    await enrollStudents({
      eventId: destino.eventoId,
      studentIds: rows.map(r => r.academicaId),
      agendadoPor: input.actor.nombre,
      agendadoPorEmail: input.actor.email,
      agendadoPorRol: input.actor.rol,
      sessionRole: input.actor.rol,
      cancelarCruces: input.cancelarCruces === true,
    })
  } catch (e) {
    await revertir(rows).catch(() => { /* si hasta revertir falla, el error original es el que importa */ })
    throw e
  }
  return { trasladados: rows.length, nombres: rows.map(r => r.nombre), destino }
}

/** Talleres › Gestión usuario: busca al alumno por su ID y lista sus talleres PRÓXIMOS. */
export async function buscarAlumnoTalleres(documento: string) {
  const doc = String(documento || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (doc.length < 4) throw new ValidationError('Escribe el ID completo del alumno')
  const alumno = (await query<any>(
    `SELECT a."_id" AS "academicaId",
            TRIM(CONCAT_WS(' ', COALESCE(p."primerNombre", a."primerNombre"), COALESCE(p."segundoNombre", a."segundoNombre"),
                                COALESCE(p."primerApellido", a."primerApellido"), COALESCE(p."segundoApellido", a."segundoApellido"))) AS nombre,
            a."numeroId", p."tipoCurso" AS curso, p."campaign", p."salon", p."contrato"
       FROM "ACADEMICA" a
       LEFT JOIN "PEOPLE" p ON p."_id" = a."peopleId"
      WHERE UPPER(REGEXP_REPLACE(COALESCE(a."numeroId", ''), '[^A-Za-z0-9]', '', 'g')) = $1
        AND COALESCE(p."contrato", '') NOT LIKE 'PRB-%'
      ORDER BY a."_createdDate" DESC
      LIMIT 1`,
    [doc]
  )).rows[0]
  if (!alumno) throw new NotFoundError('Alumno', documento)
  const talleres = (await query<any>(
    `SELECT bk."_id" AS "bookingId", c."_id" AS "eventoId", c."dia",
            COALESCE(NULLIF(c."tituloONivel", ''), c."nombreEvento") AS titulo, g."nombreCompleto" AS guia
       FROM "ACADEMICA_BOOKINGS" bk
       JOIN "CALENDARIO" c ON c."_id" = COALESCE(bk."eventoId", bk."idEvento")
       LEFT JOIN "GUIAS" g ON g."_id" = c."advisor"
      WHERE COALESCE(bk."idEstudiante", bk."studentId") = $1
        AND COALESCE(bk."cancelo", false) = false
        AND UPPER(COALESCE(c."tipo", c."evento", '')) = 'CLUB'
        AND c."dia" > NOW()
      ORDER BY c."dia" ASC`,
    [alumno.academicaId]
  )).rows.map((t: any) => ({ ...t, dia: new Date(t.dia).toISOString() }))
  return { alumno, talleres }
}
