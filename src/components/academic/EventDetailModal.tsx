'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { XMarkIcon, UserIcon, CalendarIcon, ClockIcon, UsersIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { formatEventTimeRange } from '@/lib/event-duration'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME' | 'NIVELACION'
  tipo?: string
  tituloONivel: string
  nombreEvento?: string
  advisor: string | Advisor
  advisorNombre?: string
  // Fields from ADVISORS JOIN
  advisorPrimerNombre?: string
  advisorPrimerApellido?: string
  advisorNombreCompleto?: string
  advisorEmail?: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
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

interface BookingUser {
  _id: string
  idEstudiante: string
  primerNombre: string
  primerApellido: string
  email?: string
  fuente?: string
  plataforma?: string
  pais?: string
  asistencia?: boolean
}

interface EnrichedBookingUser extends BookingUser {
  enriched?: boolean
}

interface EventDetailModalProps {
  event: CalendarEvent | null
  isOpen: boolean
  onClose: () => void
  advisors: Advisor[]
  advisorId?: string
}

export default function EventDetailModal({ event, isOpen, onClose, advisors, advisorId }: EventDetailModalProps) {
  const [bookingUsers, setBookingUsers] = useState<EnrichedBookingUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Función para obtener información del advisor
  const getAdvisorInfo = () => {
    if (!event) return null

    const advisor = event.advisor

    if (advisor && typeof advisor === 'object') {
      return advisor
    }

    if (advisor && typeof advisor === 'string') {
      return advisors.find(a => a._id === advisor) || null
    }

    return null
  }

  // Función para obtener el nombre del advisor
  const getAdvisorName = () => {
    if (!event) return 'Sin asignar'

    // First try JOIN fields from the event
    if (event.advisorNombreCompleto) {
      return event.advisorNombreCompleto
    }
    if (event.advisorPrimerNombre) {
      return `${event.advisorPrimerNombre} ${event.advisorPrimerApellido || ''}`.trim()
    }

    // Fallback to advisorNombre field
    if (event.advisorNombre) {
      return event.advisorNombre
    }

    // Last resort: lookup in advisors array
    const advisorInfo = getAdvisorInfo()
    return advisorInfo ? `${advisorInfo.primerNombre} ${advisorInfo.primerApellido}` : 'Sin asignar'
  }

  // Función para enriquecer datos de usuario desde ACADEMICA
  const enrichUserData = async (user: BookingUser): Promise<EnrichedBookingUser> => {
    // Si el email es "No disponible", buscar datos en ACADEMICA
    if (user.email === 'No disponible' && user.idEstudiante) {
      try {
        const response = await fetch('/api/postgres/academic/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idEstudiante: user.idEstudiante })
        })

        if (response.ok) {
          const data = await response.json()
          if (data.success && data.student) {
            return {
              ...user,
              plataforma: data.student.plataforma || user.plataforma,
              pais: data.student.pais || user.pais,
              enriched: true
            }
          }
        }
      } catch (error) {
        console.error('Error enriching user data:', error)
      }
    }

    return { ...user, enriched: false }
  }

  // Cargar usuarios inscritos en el evento
  const loadBookingUsers = async (eventId: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/postgres/events/${eventId}/bookings?includeStudent=true`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.bookings) {
          // Enriquecer datos de usuarios que tengan "No disponible"
          const enrichedUsers = await Promise.all(
            data.bookings.map((user: BookingUser) => enrichUserData(user))
          )
          setBookingUsers(enrichedUsers)
        } else {
          setBookingUsers([])
        }
      } else {
        throw new Error('Error al cargar los usuarios inscritos')
      }
    } catch (err) {
      console.error('Error loading booking users:', err)
      setError('Error al cargar los usuarios inscritos')
      setBookingUsers([])
    } finally {
      setLoading(false)
    }
  }

  // Cargar usuarios cuando se abre el modal con un evento
  useEffect(() => {
    if (isOpen && event?._id) {
      loadBookingUsers(event._id)
    } else {
      setBookingUsers([])
      setError(null)
    }
  }, [isOpen, event?._id])

  // Función para obtener el color del badge según el tipo
  const getEventBadgeColor = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'bg-blue-100 text-blue-800'
      case 'CLUB':
        return 'bg-green-100 text-green-800'
      case 'WELCOME':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (!isOpen || !event) return null

  const advisorInfo = getAdvisorInfo()

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-4 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <CalendarIcon className="h-6 w-6 text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Detalles del Evento
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Event Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Left Column - Event Details */}
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Información del Evento</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getEventBadgeColor(event.evento || event.tipo || '')}`}>
                    {(event.evento || event.tipo) === 'CLUB' ? 'TALLER' : (event.evento || event.tipo)}
                  </span>
                  <span className="font-medium">{event.tituloONivel}</span>
                </div>

                {event.nombreEvento && (
                  <div>
                    <span className="text-sm text-gray-600">Nombre:</span>
                    <span className="ml-2 text-sm font-medium">{event.nombreEvento}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">
                    {format(new Date(event.dia), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">
                    {formatEventTimeRange(event.dia, event.tipo || event.evento)}
                    {(event.evento || event.tipo) === 'NIVELACION' && (
                      <span className="ml-2 text-xs text-amber-700">(30 min)</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <UsersIcon className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">
                    Límite: {event.limiteUsuarios} usuarios
                  </span>
                </div>

                {event.observaciones && (
                  <div>
                    <span className="text-sm text-gray-600">Observaciones:</span>
                    <p className="text-sm mt-1">{event.observaciones}</p>
                  </div>
                )}

                {event.linkZoom && (
                  <div>
                    <a
                      href={event.linkZoom}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      🔗 Enlace Zoom
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Advisor Details */}
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Información del Guía</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-gray-500" />
                  {advisorInfo ? (
                    <Link
                      href={`/advisor/${advisorInfo._id}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {getAdvisorName()}
                    </Link>
                  ) : (
                    <span>{getAdvisorName()}</span>
                  )}
                </div>

                {advisorInfo?.pais && (
                  <div>
                    <span className="text-sm text-gray-600">País:</span>
                    <span className="ml-2 text-sm">{advisorInfo.pais}</span>
                  </div>
                )}

                {advisorInfo?.zoom && (
                  <div>
                    <span className="text-sm text-gray-600">Zoom Personal:</span>
                    <a
                      href={advisorInfo.zoom}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Enlace
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Enrolled Users Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">
              Usuarios Inscritos ({bookingUsers.length}/{event.limiteUsuarios})
            </h4>
            <div className="flex items-center gap-3">
              {!loading && (
                <>
                  <span className="text-sm px-2 py-1 rounded-full bg-green-100 text-green-800">
                    ✓ Asistieron: {bookingUsers.filter(u => u.asistencia).length}
                  </span>
                  <span className={`text-sm px-2 py-1 rounded-full ${
                    bookingUsers.length >= event.limiteUsuarios
                      ? 'bg-red-100 text-red-800'
                      : bookingUsers.length >= event.limiteUsuarios * 0.8
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {bookingUsers.length >= event.limiteUsuarios
                      ? 'Lleno'
                      : `${event.limiteUsuarios - bookingUsers.length} disponibles`
                    }
                  </span>
                </>
              )}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                  Cargando...
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm mb-4 p-3 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="max-h-60 overflow-y-auto">
              {bookingUsers.length > 0 ? (
                <div className="space-y-2">
                  {bookingUsers.map((user) => (
                    <div
                      key={user._id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <UserIcon className="h-5 w-5 text-gray-400" />
                        <div>
                          {advisorId ? (
                            <div className="font-medium text-gray-900">
                              {user.primerNombre} {user.primerApellido}
                            </div>
                          ) : (
                            <Link
                              href={`/student/${user.idEstudiante}`}
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {user.primerNombre} {user.primerApellido}
                            </Link>
                          )}
                          <div className="text-sm text-gray-600">
                            {user.email && user.email !== 'No disponible' ? (
                              user.email
                            ) : user.plataforma || user.pais ? (
                              `${user.plataforma || ''}${user.plataforma && user.pais ? ' • ' : ''}${user.pais || ''}`
                            ) : (
                              'Sin información adicional'
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {user.asistencia ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800 font-medium">
                            ✓ Asistió
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-600">
                            No asistió
                          </span>
                        )}
                        <div className="text-xs text-gray-500">
                          {user.fuente || 'ACADEMICA'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  No hay usuarios inscritos en este evento
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-200">
          {/* Botón IR A EVENTO - solo visible si advisorId está presente */}
          {advisorId && event && (
            <Link
              href={`/sesion/${event._id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              IR A EVENTO
            </Link>
          )}
          {!advisorId && <div></div>}
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}