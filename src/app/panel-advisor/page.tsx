'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import EventDetailModal from '@/components/academic/EventDetailModal'
import AdminEventRegistrarModal from '@/components/admin-events/AdminEventRegistrarModal'
import {
  CalendarIcon,
  ClockIcon,
  UserGroupIcon,
  AcademicCapIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BookOpenIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import HolidayBadge from '@/components/common/HolidayBadge'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  email?: string
  fotoAdvisor?: string | null
}

interface CalendarioEvent {
  _id: string
  nombreEvento?: string
  evento?: 'SESSION' | 'CLUB' | 'WELCOME'
  tipo?: string
  dia: string | Date
  advisor: string | Advisor
  tituloONivel: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
  estudiantesInscritosCount?: number
  estudiantesNoCalificados?: number
  inscritos?: number
  asistieron?: number
}

interface BookItem {
  name: string
  url: string
  nivel: string
  step: string
}

function PanelAdvisorContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()

  // States
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [events, setEvents] = useState<CalendarioEvent[]>([])
  // Admin events del mes (Training/Support/Observation/Meeting/Development)
  const [adminEvents, setAdminEvents] = useState<any[]>([])
  const [selectedAdminEvent, setSelectedAdminEvent] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarioEvent | null>(null)
  const [showEventDetailModal, setShowEventDetailModal] = useState(false)
  const [showDayEventsModal, setShowDayEventsModal] = useState(false)
  const [dayEventsModalDate, setDayEventsModalDate] = useState<Date | null>(null)
  const [showBooksModal, setShowBooksModal] = useState(false)
  const [books, setBooks] = useState<BookItem[]>([])
  const [booksLoading, setBooksLoading] = useState(false)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)

  // Rol del usuario logueado
  const userRole = (session?.user as any)?.role

  // Permiso para usar el selector y navegar a paneles de OTROS advisors.
  // Reusamos ACADEMICO.ADVISOR.VER_ENLACE — el mismo que ya gatea el acceso
  // a /panel-advisor en el middleware (separado de ACADEMICO.ADVISOR.LISTA_VER,
  // que rige sólo la lista en /dashboard/academic/advisors).
  //
  // Un ADVISOR puede tener VER_ENLACE pero ser redirigido a SU propio panel
  // (por searchParams.get('email') || session.email cuando el rol es ADVISOR).
  // El dropdown sólo aparece para roles NO-ADVISOR con el permiso.
  const { hasPermission } = usePermissions()
  const canPickOtherAdvisor = hasPermission(AcademicoPermission.ADVISOR_VER_ENLACE) && userRole !== 'ADVISOR'

  // Get email from URL params; fall back to session email for logged-in ADVISORs
  const advisorEmail = searchParams.get('email') || (
    userRole === 'ADVISOR' ? session?.user?.email ?? null : null
  )

  // Lista de advisors para el selector (sólo se carga si tiene el permiso)
  const [availableAdvisors, setAvailableAdvisors] = useState<Advisor[]>([])

  // Cargar lista de advisors si el usuario tiene permiso (para el selector)
  useEffect(() => {
    if (!canPickOtherAdvisor) return
    fetch('/api/postgres/advisors')
      .then(r => r.json())
      .then(j => setAvailableAdvisors(j.advisors || j.data || []))
      .catch(() => { /* silencioso — el dropdown queda vacío */ })
  }, [canPickOtherAdvisor])

  // Load advisor data
  useEffect(() => {
    if (advisorEmail) {
      loadAdvisor(advisorEmail)
    } else if (canPickOtherAdvisor && availableAdvisors.length > 0) {
      // Usuario con permiso pero sin email en URL: auto-seleccionar el primero
      const first = availableAdvisors[0]
      if (first?.email) {
        router.replace(`/panel-advisor?email=${encodeURIComponent(first.email)}`)
      } else {
        setError('No hay advisors disponibles')
        setLoading(false)
      }
    } else if (!canPickOtherAdvisor) {
      setError('No se proporcionó un email de advisor en la URL')
      setLoading(false)
    }
    // Si tiene permiso y availableAdvisors aún cargando, esperar al siguiente render
  }, [advisorEmail, canPickOtherAdvisor, availableAdvisors, router])

  function handleAdvisorChange(email: string) {
    if (!email) return
    router.replace(`/panel-advisor?email=${encodeURIComponent(email)}`)
  }

  // Load events when advisor or month changes
  useEffect(() => {
    if (advisor) {
      loadEvents()
    }
  }, [advisor, currentMonth])

  const loadAdvisor = async (email: string) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(email)}`)

      if (!response.ok) {
        throw new Error('Error al buscar advisor')
      }

      const data = await response.json()

      if (data.success && data.advisor) {
        setAdvisor(data.advisor)
        // Load presigned URL for advisor photo
        if (data.advisor.fotoAdvisor) {
          fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(data.advisor.fotoAdvisor)}`)
            .then(r => r.json())
            .then(d => { if (d.signedUrl) setFotoUrl(d.signedUrl) })
            .catch(() => {})
        }
      } else {
        throw new Error(data.error || 'Advisor no encontrado')
      }
    } catch (error) {
      console.error('Error loading advisor:', error)
      setError(error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const loadEvents = async () => {
    if (!advisor) return

    try {
      setEventsLoading(true)

      // Usar el mes actual del calendario
      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)

      const startDate = monthStart.toISOString().split('T')[0]
      const endDate = monthEnd.toISOString().split('T')[0]

      const response = await fetch(`/api/postgres/calendar/events?startDate=${startDate}&endDate=${endDate}&advisor=${encodeURIComponent(advisor._id)}&limit=1000`)

      if (!response.ok) {
        throw new Error('Error al cargar eventos')
      }

      const data = await response.json()

      // Cargar admin events del mes en paralelo (no bloquean si fallan)
      fetch(`/api/postgres/advisors/${advisor._id}/admin-events?year=${currentMonth.getFullYear()}&month=${currentMonth.getMonth() + 1}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(j => { if (j?.success) setAdminEvents(j.items || []) })
        .catch(() => setAdminEvents([]))

      if (data.success) {
        const eventos = data.data || []

        if (eventos.length === 0) {
          setEvents([])
          return
        }

        // Obtener IDs de todos los eventos
        const eventIds = eventos.map((event: CalendarioEvent) => event._id)

        // Usar el endpoint batch para obtener todos los conteos de una vez (más eficiente)
        const countsResponse = await fetch('/api/postgres/events/batch-counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventIds })
        })

        let inscritosCounts: { [key: string]: number } = {}
        let asistenciasCounts: { [key: string]: number } = {}

        if (countsResponse.ok) {
          const countsData = await countsResponse.json()
          inscritosCounts = countsData.inscritosCounts || {}
          asistenciasCounts = countsData.asistenciasCounts || {}
        }

        // Mapear los eventos con sus conteos
        const eventsWithCounts = eventos.map((event: CalendarioEvent) => {
          const inscritos = inscritosCounts[event._id] || 0
          const asistieron = asistenciasCounts[event._id] || 0
          const noCalificados = inscritos - asistieron

          return {
            ...event,
            estudiantesInscritosCount: inscritos,
            estudiantesNoCalificados: noCalificados > 0 ? noCalificados : 0
          }
        })

        setEvents(eventsWithCounts)
      }
    } catch (error) {
      console.error('Error loading events:', error)
    } finally {
      setEventsLoading(false)
    }
  }

  const loadBooks = async () => {
    try {
      setBooksLoading(true)
      const response = await fetch('/api/postgres/materials/books')

      if (!response.ok) {
        throw new Error('Error al cargar libros')
      }

      const data = await response.json()

      if (data.success && data.books) {
        setBooks(data.books)
      }
    } catch (error) {
      console.error('Error loading books:', error)
    } finally {
      setBooksLoading(false)
    }
  }

  const handleOpenBooksModal = () => {
    setShowBooksModal(true)
    if (books.length === 0) {
      loadBooks()
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
    const dayAdminEvents = getAdminEventsForDay(date)
    if (dayEvents.length > 0 || dayAdminEvents.length > 0) {
      setDayEventsModalDate(date)
      setShowDayEventsModal(true)
    }
  }

  const handleEventClick = (event: CalendarioEvent) => {
    setSelectedEvent(event)
    setShowEventDetailModal(true)
  }

  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.dia)
      return isSameDay(eventDate, date)
    })
  }

  const getAdminEventsForDay = (date: Date) => {
    return adminEvents.filter(ae => isSameDay(new Date(ae.fechaInicio), date))
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

  // Calcular el grid del calendario
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 })
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const dateRange = eachDayOfInterval({ start: startDate, end: endDate })
  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Cargando...</div>
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">{error}</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="border-b border-gray-200 pb-4 flex items-center gap-4">
          {/* Advisor photo */}
          <div className="flex-shrink-0 w-16 h-16 rounded-full overflow-hidden bg-gray-100 border-2 border-blue-200">
            {fotoUrl
              ? <img src={fotoUrl} alt="Foto advisor" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center bg-blue-100">
                  <span className="text-2xl font-bold text-blue-600">
                    {advisor?.primerNombre?.[0]?.toUpperCase() || 'A'}
                  </span>
                </div>
            }
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">
              ¡Hola {advisor?.primerNombre}!
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Panel de gestión para advisors
            </p>
          </div>

          {/* Selector de advisor — sólo visible para usuarios con permiso
              ACADEMICO.ADVISOR.LISTA_VER. Un ADVISOR sin este permiso ve
              únicamente su propio panel (email de la sesión, sin selector). */}
          {canPickOtherAdvisor && availableAdvisors.length > 0 && (
            <div className="ml-auto">
              <label htmlFor="advisor-switcher" className="block text-xs font-medium text-gray-500 mb-1">
                Ver panel de
              </label>
              <select
                id="advisor-switcher"
                value={advisor?.email ?? advisorEmail ?? ''}
                onChange={e => handleAdvisorChange(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[220px]"
              >
                {availableAdvisors.map(a => (
                  <option key={a._id} value={a.email ?? ''}>
                    {[a.primerNombre, a.primerApellido].filter(Boolean).join(' ') || a.email || a._id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Botón de Libros */}
        <div className="-mt-2">
          <button
            onClick={handleOpenBooksModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <BookOpenIcon className="h-5 w-5" />
            Descargar Libros
          </button>
        </div>

        {/* Calendar View */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-6">
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

          {eventsLoading ? (
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
                      <div className="text-sm font-medium mb-1 flex items-center gap-1">
                        {format(date, 'd')}
                        <HolidayBadge date={date} size="xs" />
                      </div>
                      <div className="space-y-1">
                        {dayEvents.slice(0, 3).map(event => (
                          <div
                            key={event._id}
                            className={`text-xs px-1 py-0.5 rounded text-white truncate ${getEventColor(event.evento || event.tipo || '')} cursor-pointer hover:opacity-80`}
                            title={`${event.evento || event.tipo || ''} - ${event.tituloONivel} ${event.nombreEvento || ''}`}
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
                        {/* Admin events del día — color naranja (Welcome ya es morado).
                            Click abre modal de registro. */}
                        {getAdminEventsForDay(date).slice(0, 2).map(ae => (
                          <div
                            key={ae._id}
                            className={`text-xs px-1 py-0.5 rounded text-white truncate cursor-pointer hover:opacity-80 ${
                              ae.registrado ? 'bg-orange-400' : 'bg-orange-600'
                            }`}
                            title={`[ADMIN ${ae.tipo}] ${ae.titulo || ''} · ${ae.horas}h${ae.registrado ? ' (registrado)' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setSelectedAdminEvent(ae) }}
                          >
                            {format(new Date(ae.fechaInicio), 'HH:mm')} · {ae.tipo}
                          </div>
                        ))}
                        {getAdminEventsForDay(date).length > 2 && (
                          <div className="text-xs text-orange-600">
                            +{getAdminEventsForDay(date).length - 2} admin
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

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
                  </div>
                </div>
              ))}
              {/* Admin events del día — color naranja, click abre modal de registro */}
              {getAdminEventsForDay(dayEventsModalDate).map(ae => (
                <div
                  key={ae._id}
                  onClick={() => {
                    setShowDayEventsModal(false)
                    setDayEventsModalDate(null)
                    setSelectedAdminEvent(ae)
                  }}
                  className={`p-3 rounded-lg cursor-pointer hover:opacity-80 transition-opacity text-white ${
                    ae.registrado ? 'bg-orange-400' : 'bg-orange-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {format(new Date(ae.fechaInicio), 'HH:mm')} - [ADMIN] {ae.tipo}
                      </div>
                      <div className="text-sm opacity-90">
                        {ae.titulo || 'Sin título'} · {ae.horas}h{ae.registrado ? ' · ✓ Registrado' : ''}
                      </div>
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

      {/* Books Modal */}
      {showBooksModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <BookOpenIcon className="h-6 w-6 text-indigo-600" />
                Libros Disponibles
              </h3>
              <button
                onClick={() => setShowBooksModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {booksLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              </div>
            ) : books.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No hay libros disponibles
              </div>
            ) : (
              <div className="space-y-3">
                {books.map((book, idx) => (
                  <a
                    key={idx}
                    href={book.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-indigo-50 transition-colors group"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200">
                      <ArrowDownTrayIcon className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {book.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {book.nivel} - {book.step}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            )}

            <div className="mt-6 text-center">
              <button
                onClick={() => setShowBooksModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      <EventDetailModal
        event={selectedEvent ? { ...selectedEvent, dia: new Date(selectedEvent.dia) } : null}
        isOpen={showEventDetailModal}
        onClose={() => {
          setShowEventDetailModal(false)
          setSelectedEvent(null)
          // Recargar eventos para actualizar contadores
          loadEvents()
        }}
        advisors={advisor ? [advisor] : []}
        advisorId={advisor?._id}
      />

      {/* Modal Admin Event: ver detalle + registrar (ventana +40/+120) */}
      {selectedAdminEvent && (
        <AdminEventRegistrarModal
          event={selectedAdminEvent}
          onClose={() => setSelectedAdminEvent(null)}
          onSaved={() => { setSelectedAdminEvent(null); loadEvents() }}
        />
      )}
    </DashboardLayout>
  )
}

export default function PanelAdvisorPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando...</p>
          </div>
        </div>
      </DashboardLayout>
    }>
      <PanelAdvisorContent />
    </Suspense>
  )
}
