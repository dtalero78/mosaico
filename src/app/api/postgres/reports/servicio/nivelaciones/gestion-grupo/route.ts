import 'server-only'
import { handlerWithAuth, successResponse } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/api-permissions'
import { ValidationError } from '@/lib/errors'
import { createEvent } from '@/services/calendar.service'
import { enrollStudents } from '@/services/enrollment.service'
import { ServicioPermission } from '@/types/permissions'

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
 * El agendamiento es best-effort respecto del evento: si el evento se crea y
 * el agendamiento falla, se informa el evento creado para que se pueda
 * completar a mano en vez de perderlo.
 */
const MAX_ALUMNOS = 60

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
    campaign: campaign || undefined,
    curso: curso || undefined,
    salon: salon || undefined,
  })

  let enrolled = 0
  let enrollError: string | null = null
  try {
    const res = await enrollStudents({
      eventId: event._id,
      studentIds: academicaIds,
      agendadoPor: session?.user?.name || undefined,
      agendadoPorEmail: session?.user?.email || undefined,
      agendadoPorRol: (session?.user as any)?.role || undefined,
      sessionRole: (session?.user as any)?.role || undefined,
    })
    enrolled = res.enrolled
  } catch (e: any) {
    enrollError = e?.message || 'Error al agendar a los estudiantes'
  }

  return successResponse({
    event,
    enrolled,
    enrollError,
    message: enrollError
      ? `Nivelación creada, pero el agendamiento falló: ${enrollError}`
      : `Nivelación creada y ${enrolled} estudiante(s) agendado(s)`,
  })
})
