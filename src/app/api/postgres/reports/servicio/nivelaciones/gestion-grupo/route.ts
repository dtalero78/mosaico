import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ValidationError } from '@/lib/errors'
import { createEvent } from '@/services/calendar.service'
import { enrollStudents } from '@/services/enrollment.service'
import { ServicioPermission } from '@/types/permissions'
import { query, queryOne } from '@/lib/postgres'

/**
 * POST /api/postgres/reports/servicio/nivelaciones/gestion-grupo
 *
 * Crea UNA nivelación para un grupo de alumnos ya aprobados y los agenda en el
 * acto. Es un solo endpoint —y no dos llamadas desde el navegador— porque de
 * otro modo un fallo a mitad de camino dejaría el evento creado y sin nadie
 * dentro, invisible para quien lo está gestionando.
 *
 * Va gateado por SERVICIO.NIVELACIONES.GESTION: quien gestiona nivelaciones
 * crea el evento de la nivelación, sin necesitar el permiso general de crear
 * eventos del calendario.
 *
 * Es TODO O NADA: si el agendamiento falla (un alumno inactivo, o con una clase
 * que se cruza con el horario), el evento recién creado se borra y se responde
 * el motivo como error; el grupo queda intacto en Agrupaciones para corregirlo.
 */
const MAX_ALUMNOS = 60

/**
 * Confirmada la agrupación, el grupo pasa a ser el EVENTO: el borrador ya no
 * aporta y dejarlo colgado haría que un alumno agendado siguiera contando en un
 * grupo sin agendar. Si el evento se borra, vuelven a Agrupaciones sin grupo.
 */
async function limpiarGrupoBorrador(academicaIds: string[]) {
  await query(
    `UPDATE "ACADEMICA"
        SET "detalleNivelacion" = COALESCE("detalleNivelacion", '{}'::jsonb) - 'grupoId',
            "_updatedDate" = NOW()
      WHERE "_id" = ANY($1::text[])`,
    [academicaIds]
  )
}

export const POST = handlerWithAuth(async (request, _ctx, session) => {
  await requirePermission(session, ServicioPermission.NIVELACIONES_GESTION)

  const body = await request.json()

  const academicaIds: string[] = Array.isArray(body?.academicaIds)
    ? body.academicaIds.filter((x: any) => typeof x === 'string' && x.trim())
    : []
  if (!academicaIds.length) throw new ValidationError('Selecciona al menos un estudiante.')
  if (academicaIds.length > MAX_ALUMNOS) {
    throw new ValidationError(`Máximo ${MAX_ALUMNOS} estudiantes por grupo.`)
  }

  // ── Modo "sumar a una sesión ya agendada" ──
  // Para el alumno que queda solo en Agrupaciones sin nadie de su curso con quien
  // agruparse, pero que sí encaja en una nivelación ya creada. Aquí NO se crea
  // evento: sólo se inscribe en el existente, que debe seguir siendo futuro
  // (sumarlo a uno ya dictado lo dejaría con una ausencia que nunca ocurrió).
  const eventoExistenteId = String(body?.eventoExistenteId || '').trim()
  if (eventoExistenteId) {
    const ev = await queryOne<{ _id: string; dia: Date; tipo: string | null; sesionCerrada: boolean | null }>(
      `SELECT "_id", "dia", "tipo", "sesionCerrada" FROM "CALENDARIO" WHERE "_id" = $1`,
      [eventoExistenteId]
    )
    if (!ev) throw new ValidationError('La nivelación indicada ya no existe.')
    if (String(ev.tipo || '').toUpperCase() !== 'NIVELACION') {
      throw new ValidationError('El evento indicado no es una nivelación.')
    }
    if (ev.sesionCerrada === true) throw new ValidationError('Esa nivelación ya fue registrada.')
    if (new Date(ev.dia).getTime() <= Date.now()) {
      throw new ValidationError('Esa nivelación ya se dictó: elige una futura o crea un grupo nuevo.')
    }

    // Un fallo se responde como ERROR: antes volvía como éxito y la pantalla lo
    // mostraba en un aviso verde, como si se hubiera sumado a alguien.
    let sumados = 0
    try {
      const res = await enrollStudents({
        eventId: ev._id,
        studentIds: academicaIds,
        agendadoPor: session?.user?.name || undefined,
        agendadoPorEmail: session?.user?.email || undefined,
        agendadoPorRol: (session?.user as any)?.role || undefined,
        sessionRole: (session?.user as any)?.role || undefined,
        // Gestión de grupo crea la nivelación con el cupo que se acaba de
        // elegir: agendamiento masivo, sin modal de sobrecupo.
        masivo: true,
      })
      sumados = res.enrolled
    } catch (e: any) {
      throw new ValidationError(`No se pudo sumar a la nivelación: ${e?.message || 'error al agendar a los estudiantes'}`)
    }
    await limpiarGrupoBorrador(academicaIds)

    return successResponse({
      event: ev,
      enrolled: sumados,
      message: `${sumados} usuario(s) sumado(s) a la nivelación ya agendada`,
    })
  }

  const advisor = String(body?.advisor || '').trim()
  const fecha = String(body?.fecha || '').trim()   // YYYY-MM-DD
  const hora = String(body?.hora || '').trim()     // HH:MM
  if (!advisor) throw new ValidationError('El guía es obligatorio.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ValidationError('La fecha es obligatoria.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new ValidationError('La hora es obligatoria (HH:MM).')

  const curso = String(body?.curso || '').trim() || null
  const modulo = String(body?.modulo || '').trim() || null
  const leccion = String(body?.leccion || '').trim() || null
  const campaign = String(body?.campaign || '').trim() || null
  const salon = String(body?.salon || '').trim() || null
  const linkZoom = String(body?.linkZoom || '').trim() || undefined
  const limiteUsuarios = Number(body?.limiteUsuarios) > 0 ? Number(body.limiteUsuarios) : 30
  // La nivelación dura 30 min salvo que se pida ampliarla a una hora.
  const duracionMin = body?.unaHora === true ? 60 : 30

  // El instante lo arma el NAVEGADOR (`dia`), igual que el modal de eventos del
  // calendario: quien crea la nivelación elige 19:00 y eso es 19:00 en SU reloj.
  // Construirlo aquí lo interpretaría en la zona del servidor (UTC en producción)
  // y el evento saldría corrido varias horas.
  const dia = String(body?.dia || '').trim()
  if (!dia || Number.isNaN(new Date(dia).getTime())) {
    throw new ValidationError('Fecha y hora inválidas.')
  }

  // Mismo armado de título que el modal de eventos: "Curso - Módulo - Lección".
  const partes = [modulo, leccion].filter((x) => x && x !== 'Todos')
  const tituloONivel = curso
    ? (partes.length ? `${curso} - ${partes.join(' - ')}` : curso)
    : partes.join(' - ')

  const event: any = await createEvent({
    dia,
    fecha,
    hora,
    advisor,
    nivel: modulo || undefined,
    step: leccion || undefined,
    tipo: 'NIVELACION',
    titulo: tituloONivel || 'Nivelación',
    nombreEvento: leccion || undefined,
    tituloONivel: tituloONivel || undefined,
    linkZoom,
    limiteUsuarios,
    duracionMin,
    campaign: campaign || undefined,
    curso: curso || undefined,
    salon: salon || undefined,
  })

  // TODO O NADA. `enrollStudents` rechaza el lote ENTERO si un alumno no se puede
  // agendar (inactivo, o con una clase que se cruza con este horario). Antes el
  // evento quedaba creado y vacío: el grupo seguía en Agrupaciones como si nada y
  // los alumnos no veían ninguna sesión (pasó el 9-oct con DANSHI L11). Ahora el
  // evento recién creado —que aún no tiene a nadie— se borra y se informa el motivo.
  let enrolled = 0
  try {
    const res = await enrollStudents({
      eventId: event._id,
      studentIds: academicaIds,
      agendadoPor: session?.user?.name || undefined,
      agendadoPorEmail: session?.user?.email || undefined,
      agendadoPorRol: (session?.user as any)?.role || undefined,
      sessionRole: (session?.user as any)?.role || undefined,
      // Igual que arriba: la nivelación se acaba de crear con su cupo.
      masivo: true,
    })
    enrolled = res.enrolled
  } catch (e: any) {
    await query(
      `DELETE FROM "CALENDARIO" c WHERE c."_id" = $1
         AND NOT EXISTS (SELECT 1 FROM "ACADEMICA_BOOKINGS" b WHERE b."eventoId" = c."_id" OR b."idEvento" = c."_id")`,
      [event._id]
    ).catch(() => {})
    throw new ValidationError(
      `No se creó la nivelación: ${e?.message || 'no se pudo agendar a los estudiantes'}. ` +
      'El grupo sigue en Agrupaciones para corregirlo.'
    )
  }
  await limpiarGrupoBorrador(academicaIds)

  return successResponse({
    event,
    enrolled,
    message: `Nivelación creada y ${enrolled} estudiante(s) agendado(s)`,
  })
})
