'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { XMarkIcon, PencilIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatEventTimeRange } from '@/lib/event-duration'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME' | 'NIVELACION' | 'OLIMPIADA'
  tipo?: string
  tituloONivel: string
  nombreEvento?: string
  advisor: string | {_id: string, primerNombre: string, primerApellido: string}
  advisorNombre?: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
  inscritos?: number
  asistieron?: number
  _createdDate?: string | Date
  // Columnas propias de CALENDARIO. Solo las llenan los eventos creados a mano; los
  // generados por el motor de cursos las dejan en NULL y arman "Campana - Curso - Salon"
  // dentro de tituloONivel, asi que los filtros caen a ese texto cuando faltan.
  campaign?: string | null
  curso?: string | null
  salon?: string | null
}

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  zoom?: string
}

interface DailyAgendaProps {
  selectedDate: Date
  events: CalendarEvent[]
  advisors: Advisor[]
  onViewDetail?: (event: CalendarEvent) => void
  onEditEvent: (event: CalendarEvent) => void
  onDeleteEvent: (eventId: string) => void
  onCreateEvent: (date?: Date) => void
  onDateChange: (date: Date) => void
}

export default function DailyAgenda({
  selectedDate,
  events,
  advisors,
  onViewDetail,
  onEditEvent,
  onDeleteEvent,
  onCreateEvent,
  onDateChange
}: DailyAgendaProps) {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all')
  const [selectedCurso, setSelectedCurso] = useState<string>('all')
  const [selectedGuia, setSelectedGuia] = useState<string>('all')

  // Validar fecha
  const date = selectedDate && selectedDate instanceof Date && !isNaN(selectedDate.getTime())
    ? selectedDate
    : new Date()

  // Obtener lista única de niveles de los eventos del día
  const eventsForSelectedDay = events.filter(event => {
    const eventDate = event.dia instanceof Date ? event.dia : new Date(event.dia)
    const eventDay = eventDate.toDateString()
    const selectedDay = date.toDateString()

    return eventDay === selectedDay
  })

  // Debug logging (moved outside filter to avoid temporal dead zone)
  if (events.length > 0) {
    if (eventsForSelectedDay.length === 0) {
      console.log('🔍 [DailyAgenda] Debug - No events found:', {
        totalEvents: events.length,
        selectedDay: date.toDateString(),
        firstEventDay: new Date(events[0].dia).toDateString(),
        firstEventDia: events[0].dia,
        match: new Date(events[0].dia).toDateString() === date.toDateString()
      })
    } else {
      console.log('🔍 [DailyAgenda] Debug - Events found:', {
        eventsForSelectedDay: eventsForSelectedDay.length,
        selectedDay: date.toDateString(),
        eventDetails: eventsForSelectedDay.map(e => ({
          dia: e.dia,
          diaDate: new Date(e.dia),
          hour: new Date(e.dia).getHours(),
          evento: e.evento,
          nivel: e.tituloONivel
        }))
      })
    }
  }

  // Función para obtener el nombre del advisor
  const getAdvisorName = (event: any): string => {
    // Primero, verificar si ya tenemos advisorNombre calculado
    if (event.advisorNombre) {
      return event.advisorNombre
    }

    const advisor = event.advisor

    // Si advisor es un objeto, usar sus datos directamente
    if (advisor && typeof advisor === 'object' && advisor.primerNombre) {
      return `${advisor.primerNombre} ${advisor.primerApellido || ''}`.trim()
    }

    // Si advisor es un string ID, buscar en la lista de advisors
    if (advisor && typeof advisor === 'string') {
      const advisorObj = advisors.find(a => a._id === advisor)
      return advisorObj ? `${advisorObj.primerNombre} ${advisorObj.primerApellido}` : 'Sin asignar'
    }

    return 'Sin asignar'
  }

  // Función para obtener el ID del advisor
  const getAdvisorId = (event: any): string | null => {
    const advisor = event.advisor

    // Si advisor es un objeto, devolver su ID
    if (advisor && typeof advisor === 'object' && advisor._id) {
      return advisor._id
    }

    // Si advisor es un string ID
    if (advisor && typeof advisor === 'string') {
      return advisor
    }

    return null
  }

  // Los eventos generados por el motor de cursos dejan campaign/curso en NULL y arman
  // "Campana - Curso - Salon" en tituloONivel; los creados a mano llenan las columnas
  // pero su titulo tiene otra forma. Se prefiere la columna y se cae al texto.
  const tituloSegmento = (tituloONivel: string, i: number) =>
    ((tituloONivel || '').split(' - ')[i] || '').trim()

  const eventCampaign = (e: CalendarEvent) =>
    (e.campaign || '').trim() || tituloSegmento(e.tituloONivel, 0)

  const eventCurso = (e: CalendarEvent) => {
    const col = (e.curso || '').trim()
    // 'Todos' es el comodin del modal de creacion: no identifica un curso.
    if (col && col.toUpperCase() !== 'TODOS') return col
    return tituloSegmento(e.tituloONivel, 1)
  }

  const matchCampaign = (e: CalendarEvent) =>
    selectedCampaign === 'all' || eventCampaign(e) === selectedCampaign
  const matchCurso = (e: CalendarEvent) =>
    selectedCurso === 'all' || eventCurso(e) === selectedCurso
  const matchGuia = (e: CalendarEvent) =>
    selectedGuia === 'all' || getAdvisorId(e) === selectedGuia

  const filteredEvents = eventsForSelectedDay.filter(
    e => matchCampaign(e) && matchCurso(e) && matchGuia(e)
  )

  const uniqOrdenado = (valores: string[]) =>
    Array.from(new Set(valores.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))

  // Los tres desplegables listan SIEMPRE todo lo del dia, sin acotarse entre si: al
  // acotarlos, elegir campana + curso podia dejar un desplegable con una sola opcion
  // y al usuario sin forma de cambiar de seleccion. Las combinaciones imposibles no
  // llegan a darse porque al mover un filtro se limpian los otros que queden huerfanos.
  const availableCampaigns = uniqOrdenado(eventsForSelectedDay.map(eventCampaign))
  const availableCursos = uniqOrdenado(eventsForSelectedDay.map(eventCurso))
  const availableGuias = Array.from(
    eventsForSelectedDay
      .reduce((acc, e) => {
        const id = getAdvisorId(e)
        if (id) acc.set(id, getAdvisorName(e))
        return acc
      }, new Map<string, string>())
      .entries()
  ).sort((a, b) => a[1].localeCompare(b[1], 'es'))

  const nombreGuiaSeleccionado =
    availableGuias.find(([id]) => id === selectedGuia)?.[1] || selectedGuia

  const filtrosActivos = [
    selectedCampaign !== 'all' ? selectedCampaign : null,
    selectedCurso !== 'all' ? selectedCurso : null,
    selectedGuia !== 'all' ? nombreGuiaSeleccionado : null,
  ].filter(Boolean) as string[]
  const hayFiltroActivo = filtrosActivos.length > 0

  // Al elegir un filtro, los OTROS dos pueden quedar sin eventos que los respalden
  // (p.ej. el curso elegido no se dicta en la campana recien seleccionada). Se limpian
  // solo esos: el filtro que el usuario acaba de tocar siempre se respeta, porque
  // devolverlo a 'all' descartaria justo lo que pidio.
  const limpiarFiltrosHuerfanos = (
    base: CalendarEvent[],
    excepto: 'campaign' | 'curso' | 'guia'
  ) => {
    if (excepto !== 'campaign' && selectedCampaign !== 'all' &&
        !base.some(e => eventCampaign(e) === selectedCampaign)) {
      setSelectedCampaign('all')
    }
    if (excepto !== 'curso' && selectedCurso !== 'all' &&
        !base.some(e => eventCurso(e) === selectedCurso)) {
      setSelectedCurso('all')
    }
    if (excepto !== 'guia' && selectedGuia !== 'all' &&
        !base.some(e => getAdvisorId(e) === selectedGuia)) {
      setSelectedGuia('all')
    }
  }

  const cambiarCampaign = (valor: string) => {
    setSelectedCampaign(valor)
    limpiarFiltrosHuerfanos(
      eventsForSelectedDay.filter(e => valor === 'all' || eventCampaign(e) === valor),
      'campaign'
    )
  }

  const cambiarCurso = (valor: string) => {
    setSelectedCurso(valor)
    limpiarFiltrosHuerfanos(
      eventsForSelectedDay.filter(e => valor === 'all' || eventCurso(e) === valor),
      'curso'
    )
  }

  const cambiarGuia = (valor: string) => {
    setSelectedGuia(valor)
    limpiarFiltrosHuerfanos(
      eventsForSelectedDay.filter(e => valor === 'all' || getAdvisorId(e) === valor),
      'guia'
    )
  }

  // Otro dia trae otras campanas, cursos y guias: arrastrar los filtros anteriores
  // mostraria una agenda vacia sin decir por que. Se abre el dia completo.
  const diaKey = date.toDateString()
  useEffect(() => {
    setSelectedCampaign('all')
    setSelectedCurso('all')
    setSelectedGuia('all')
  }, [diaKey])

  // Generar horas del día desde las 6:00 AM hasta las 23:00
  const hours = Array.from({ length: 18 }, (_, i) => i + 6)

  // Agrupar eventos por hora SOLO del día seleccionado y ya filtrados
  const eventsByHour = hours.map(hour => {
    const hourEvents = filteredEvents.filter(event => {
      const eventDate = new Date(event.dia)
      const eventHour = eventDate.getHours()
      return eventHour === hour
    })

    return {
      hour,
      events: hourEvents.sort((a, b) => {
        const timeA = new Date(a.dia).getTime()
        const timeB = new Date(b.dia).getTime()
        if (timeA !== timeB) return timeA - timeB
        const createdA = a._createdDate ? new Date(a._createdDate).getTime() : 0
        const createdB = b._createdDate ? new Date(b._createdDate).getTime() : 0
        return createdA - createdB
      })
    }
  })


  // Función para obtener el color según el tipo de evento
  const getEventColor = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'bg-blue-50 border-blue-200 text-blue-900'
      case 'CLUB':
        return 'bg-green-50 border-green-200 text-green-900'
      case 'WELCOME':
        return 'bg-purple-50 border-purple-200 text-purple-900'
      case 'OLIMPIADA':
        return 'bg-yellow-50 border-yellow-200 text-yellow-900'
      case 'NIVELACION':
        return 'bg-amber-50 border-amber-200 text-amber-900'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-900'
    }
  }

  // Función para obtener el badge del tipo de evento
  const getEventBadge = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'badge-info'
      case 'CLUB':
        return 'badge-success'
      case 'WELCOME':
        return 'badge-warning'
      case 'OLIMPIADA':
        return 'badge-warning'
      case 'NIVELACION':
        return 'badge-warning'
      default:
        return 'badge-secondary'
    }
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Agenda del {format(date, "d 'de' MMMM", { locale: es })}
          </h3>
          <p className="text-sm text-gray-500">
            {eventsForSelectedDay.length} evento{eventsForSelectedDay.length !== 1 ? 's' : ''} programado{eventsForSelectedDay.length !== 1 ? 's' : ''}
            {hayFiltroActivo && ` (${filteredEvents.length} tras filtrar: ${filtrosActivos.join(' · ')})`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {availableCampaigns.length > 0 && (
            <select
              value={selectedCampaign}
              onChange={(e) => cambiarCampaign(e.target.value)}
              aria-label="Filtrar por campaña"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todas las CAMPAÑAS</option>
              {availableCampaigns.map(campaign => (
                <option key={campaign} value={campaign}>
                  {campaign}
                </option>
              ))}
            </select>
          )}
          {availableCursos.length > 0 && (
            <select
              value={selectedCurso}
              onChange={(e) => cambiarCurso(e.target.value)}
              aria-label="Filtrar por curso"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los cursos</option>
              {availableCursos.map(curso => (
                <option key={curso} value={curso}>
                  {curso}
                </option>
              ))}
            </select>
          )}
          {availableGuias.length > 0 && (
            <select
              value={selectedGuia}
              onChange={(e) => cambiarGuia(e.target.value)}
              aria-label="Filtrar por guía"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los guías</option>
              {availableGuias.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => onCreateEvent(date)}
            className="btn btn-primary btn-sm"
          >
            + Nuevo Evento
          </button>
        </div>
      </div>

      {/* Agenda por horas */}
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {eventsByHour.map(({ hour, events: hourEvents }) => (
          <div key={hour} className="flex gap-4">
            {/* Hora */}
            <div className="w-16 flex-shrink-0 text-sm font-medium text-gray-500 pt-2">
              {`${hour.toString().padStart(2, '0')}:00`}
            </div>

            {/* Eventos de la hora */}
            <div className="flex-1">
              {hourEvents.length > 0 ? (
                <div className="space-y-2">
                  {hourEvents.map(event => (
                    <div
                      key={event._id}
                      className={`p-3 rounded-lg border cursor-pointer hover:shadow-md transition-shadow ${getEventColor(event.evento || event.tipo || '')}`}
                      onClick={() => onViewDetail ? onViewDetail(event) : onEditEvent(event)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`badge ${getEventBadge(event.evento || event.tipo || '')}`}>
                              {(event.evento || event.tipo) === 'CLUB' ? 'TALLER' : (event.evento || event.tipo)}
                            </span>
                            <span className="font-medium text-sm">
                              {event.tituloONivel}
                            </span>
                            <span className="text-xs text-gray-500 font-medium">
                              · {formatEventTimeRange(event.dia, event.tipo || event.evento, event.nombreEvento, (event as any).duracionMin)}
                            </span>
                          </div>

                          <div className="text-sm text-gray-600 space-y-1">
                            <div>
                              <span className="font-medium">Guía:</span>{' '}
                              {getAdvisorId(event) ? (
                                <Link
                                  href={`/advisor/${getAdvisorId(event)}`}
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {getAdvisorName(event)}
                                </Link>
                              ) : (
                                getAdvisorName(event)
                              )}
                            </div>

                            {event.observaciones && (
                              <div>
                                <span className="font-medium">Observaciones:</span>{' '}
                                {event.observaciones}
                              </div>
                            )}

                            <div className="flex gap-4">
                              <div>
                                <span className="font-medium">Inscritos:</span>{' '}
                                <span className={event.inscritos === event.limiteUsuarios ? 'text-red-600 font-medium' : ''}>
                                  {event.inscritos || 0}/{event.limiteUsuarios}
                                </span>
                              </div>
                              <div>
                                <span className="font-medium">Asistieron:</span>{' '}
                                <span className="text-green-600 font-medium">
                                  {event.asistieron || 0}
                                </span>
                              </div>

                              {event.linkZoom && (
                                <div>
                                  <a
                                    href={event.linkZoom}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    🔗 Zoom
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onEditEvent(event)
                            }}
                            className="p-1 hover:bg-white/50 rounded transition-colors"
                            title="Editar evento"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteEvent(event._id)
                            }}
                            className="p-1 hover:bg-red-50 text-red-600 rounded transition-colors"
                            title="Eliminar evento"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-12 flex items-center">
                  <div className="w-full h-px bg-gray-200"></div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Resumen */}
      {filteredEvents.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-2">
            Resumen {hayFiltroActivo ? `- ${filtrosActivos.join(' · ')}` : 'del día'}
          </h4>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Sessions:</span>
              <span className="ml-2 font-medium">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'SESSION').length}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Talleres:</span>
              <span className="ml-2 font-medium">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'CLUB').length}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Welcome:</span>
              <span className="ml-2 font-medium">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'WELCOME').length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}