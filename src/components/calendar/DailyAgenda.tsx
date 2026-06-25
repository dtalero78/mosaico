'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { XMarkIcon, PencilIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME'
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
  const [selectedNivel, setSelectedNivel] = useState<string>('all')

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

  // Extract base nivel code: "BN2 - Step 9" → "BN2", "P1 - TRAINING - Step 19" → "P1"
  const extractNivelCode = (tituloONivel: string) =>
    (tituloONivel || '').split(' - ')[0].trim()

  const availableNiveles = Array.from(
    new Set(eventsForSelectedDay.map(e => extractNivelCode(e.tituloONivel)))
  ).sort()

  // Filtrar eventos por nivel seleccionado
  const filteredEvents = selectedNivel === 'all'
    ? eventsForSelectedDay
    : eventsForSelectedDay.filter(e => extractNivelCode(e.tituloONivel) === selectedNivel)

  // Generar horas del día desde las 6:00 AM hasta las 23:00
  const hours = Array.from({ length: 18 }, (_, i) => i + 6)

  // Agrupar eventos por hora SOLO del día seleccionado y filtrados por nivel
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

  // Función para obtener el color según el tipo de evento
  const getEventColor = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'bg-blue-50 border-blue-200 text-blue-900'
      case 'CLUB':
        return 'bg-green-50 border-green-200 text-green-900'
      case 'WELCOME':
        return 'bg-purple-50 border-purple-200 text-purple-900'
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
            {selectedNivel !== 'all' && ` (${filteredEvents.length} en ${selectedNivel})`}
          </p>
        </div>
        <div className="flex gap-2">
          {availableNiveles.length > 0 && (
            <select
              value={selectedNivel}
              onChange={(e) => setSelectedNivel(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos los niveles</option>
              {availableNiveles.map(nivel => (
                <option key={nivel} value={nivel}>
                  {nivel}
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
            Resumen {selectedNivel !== 'all' ? `- ${selectedNivel}` : 'del día'}
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