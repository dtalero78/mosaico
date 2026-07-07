'use client'

import { useState, useEffect } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import EventDetailModal from '@/components/academic/EventDetailModal'

interface AdvisorStatsProps {
  advisorId: string
  advisorName: string
}

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME'
  tipo?: string
  tituloONivel: string
  nombreEvento?: string
  advisor: string
  limiteUsuarios: number
  inscritos?: number
  asistieron?: number
}

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  zoom?: string
  pais?: string
}

export default function AdvisorStats({ advisorId, advisorName }: AdvisorStatsProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [showEventModal, setShowEventModal] = useState(false)
  const [showDayEventsModal, setShowDayEventsModal] = useState(false)
  const [dayEventsModalDate, setDayEventsModalDate] = useState<Date | null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])

  useEffect(() => {
    loadEvents()
    loadAdvisors()
  }, [currentMonth, advisorId])

  const loadAdvisors = async () => {
    try {
      const response = await fetch('/api/postgres/guias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.advisors) {
          setAdvisors(data.advisors)
        }
      }
    } catch (error) {
      console.error('Error loading advisors:', error)
    }
  }

  const loadEvents = async () => {
    try {
      setLoading(true)
      console.log('🔄 AdvisorStats: Loading events for advisor:', advisorId)

      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)

      const startDate = monthStart.toISOString().split('T')[0]
      const endDate = monthEnd.toISOString().split('T')[0]
      const response = await fetch(`/api/postgres/calendar/events?startDate=${startDate}&endDate=${endDate}&advisor=${encodeURIComponent(advisorId)}&limit=1000`)

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          const formattedEvents = data.data.map((event: any) => ({
            ...event,
            dia: new Date(event.dia)
          }))
          setEvents(formattedEvents)
          console.log('✅ AdvisorStats: Events loaded:', formattedEvents.length)
        }
      }
    } catch (error) {
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePrevMonth = () => {
    setCurrentMonth(prev => subMonths(prev, 1))
  }

  const handleNextMonth = () => {
    setCurrentMonth(prev => addMonths(prev, 1))
  }

  const handleDayClick = (date: Date) => {
    setSelectedDate(date)
    const dayEvents = getEventsForDay(date)
    if (dayEvents.length > 0) {
      setDayEventsModalDate(date)
      setShowDayEventsModal(true)
    }
  }

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setShowEventModal(true)
  }

  const getEventsForDay = (date: Date) => {
    return events.filter(event => isSameDay(new Date(event.dia), date))
  }

  const getEventColor = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'bg-blue-500'
      case 'CLUB':
        return 'bg-green-500'
      case 'WELCOME':
        return 'bg-purple-500'
      default:
        return 'bg-gray-500'
    }
  }

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 })
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const dateRange = eachDayOfInterval({ start: startDate, end: endDate })
  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  return (
    <div className="space-y-4">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          {format(currentMonth, 'MMMM yyyy', { locale: es })}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button
            onClick={handleNextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Week day headers */}
            {weekDays.map(day => (
              <div key={day} className="text-center text-sm font-semibold text-gray-700 py-2">
                {day}
              </div>
            ))}

            {/* Calendar days */}
            {dateRange.map((date, index) => {
              const dayEvents = getEventsForDay(date)
              const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
              const isSelected = selectedDate && isSameDay(date, selectedDate)
              const isToday = isSameDay(date, new Date())

              return (
                <div
                  key={index}
                  onClick={() => handleDayClick(date)}
                  className={`
                    min-h-[80px] p-2 border rounded-lg cursor-pointer transition-colors
                    ${!isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'}
                    ${isSelected ? 'ring-2 ring-primary-500' : ''}
                    ${isToday ? 'border-primary-500 border-2' : 'border-gray-200'}
                    hover:bg-gray-50
                  `}
                >
                  <div className="text-sm font-medium mb-1">
                    {format(date, 'd')}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map(event => (
                      <div
                        key={event._id}
                        className={`text-xs px-1 py-0.5 rounded text-white truncate ${getEventColor(event.evento || event.tipo || '')} cursor-pointer hover:opacity-80`}
                        title={`${event.evento || event.tipo || ''} - ${event.tituloONivel} ${event.nombreEvento || ''} (${event.inscritos || 0}/${event.limiteUsuarios})`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEventClick(event)
                        }}
                      >
                        {format(new Date(event.dia), 'HH:mm')} - {event.tituloONivel}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-xs text-gray-500">
                        +{dayEvents.length - 3} más
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Event Detail Modal */}
          {showEventModal && selectedEvent && (
            <EventDetailModal
              event={selectedEvent}
              isOpen={showEventModal}
              onClose={() => {
                setShowEventModal(false)
                setSelectedEvent(null)
                // Recargar eventos para actualizar contadores
                loadEvents()
              }}
              advisors={advisors}
              advisorId={advisorId}
            />
          )}

          {/* Day Events Modal */}
          {showDayEventsModal && dayEventsModalDate && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    📅 Eventos - {format(dayEventsModalDate, 'dd/MM/yyyy', { locale: es })}
                  </h3>
                  <button
                    onClick={() => {
                      setShowDayEventsModal(false)
                      setDayEventsModalDate(null)
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-2">
                  {getEventsForDay(dayEventsModalDate).map(event => (
                    <div
                      key={event._id}
                      onClick={() => {
                        setShowDayEventsModal(false)
                        setDayEventsModalDate(null)
                        handleEventClick(event)
                      }}
                      className={`p-3 rounded-lg cursor-pointer hover:opacity-80 transition-opacity ${getEventColor(event.evento || event.tipo || '')} text-white`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">
                            {format(new Date(event.dia), 'HH:mm')} - {event.tituloONivel}
                          </div>
                          <div className="text-sm opacity-90">
                            {event.evento || event.tipo} {event.nombreEvento && `- ${event.nombreEvento}`}
                          </div>
                        </div>
                        <div className="text-sm opacity-90">
                          {event.inscritos || 0}/{event.limiteUsuarios}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 text-center">
                  <button
                    onClick={() => {
                      setShowDayEventsModal(false)
                      setDayEventsModalDate(null)
                    }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 pt-4 border-t">
            <span className="text-sm font-medium text-gray-700">Leyenda:</span>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-sm text-gray-600">SESSION</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span className="text-sm text-gray-600">CLUB</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-purple-500 rounded"></div>
              <span className="text-sm text-gray-600">WELCOME</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}