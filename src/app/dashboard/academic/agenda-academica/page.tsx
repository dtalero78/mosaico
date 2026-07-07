'use client'

import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import EventDetailModal from '@/components/academic/EventDetailModal'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, getHours, isToday, addWeeks, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import { exportToExcel } from '@/lib/export-excel'
import HolidayBadge from '@/components/common/HolidayBadge'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME'
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
}

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  zoom?: string
}

export default function AgendaAcademicaPage() {
  // Estados principales
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])

  // Estados para modal de detalles
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)

  // Estados de filtros
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterAdvisor, setFilterAdvisor] = useState('')

  // Estados de navegación
  const [currentWeek, setCurrentWeek] = useState(() => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    return startOfWeek(today, { weekStartsOn: 1 })
  })

  // Estados para batch processing
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, eventsInBatch: number} | null>(null)

  // Estados para caché
  const CACHE_TTL = 5 * 60 * 1000 // 5 min (antes 30 — evita datos viejos tras cambios)
  const CACHE_KEY_PREFIX = 'agenda_academica_v2_'

  // Evitar re-renders innecesarios con useMemo
  const dateRange = useMemo(() => {
    const start = currentWeek
    const end = endOfWeek(currentWeek, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [currentWeek])

  const hours = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => i + 6) // 6AM a 11PM
  }, [])

  // Funciones de caché
  const getCacheKey = (dateRange: {start: Date, end: Date}) => {
    const startKey = `${dateRange.start.getFullYear()}_${dateRange.start.getMonth()}_${dateRange.start.getDate()}`
    const endKey = `${dateRange.end.getFullYear()}_${dateRange.end.getMonth()}_${dateRange.end.getDate()}`
    return `${CACHE_KEY_PREFIX}${startKey}_to_${endKey}`
  }

  const getFromCache = (dateRange: {start: Date, end: Date}) => {
    try {
      const cacheKey = getCacheKey(dateRange)
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const data = JSON.parse(cached)
        const now = Date.now()
        if (now - data.timestamp < CACHE_TTL) {
          const eventsWithDates = data.events.map((event: any) => ({
            ...event,
            dia: new Date(event.dia)
          }))
          console.log('✅ 📦 CACHÉ HIT - Agenda-academica: Datos cargados desde caché')
          console.log(`   → ${eventsWithDates.length} eventos`)
          return { events: eventsWithDates }
        } else {
          localStorage.removeItem(cacheKey)
          console.log('🗑️ Caché expirado eliminado para semana:', dateRange.start.toISOString().split('T')[0])
        }
      }
    } catch (error) {
      console.error('❌ Error leyendo caché:', error)
    }
    return null
  }

  const saveToCache = (dateRange: {start: Date, end: Date}, events: CalendarEvent[]) => {
    try {
      const cacheKey = getCacheKey(dateRange)
      const data = {
        timestamp: Date.now(),
        events
      }
      localStorage.setItem(cacheKey, JSON.stringify(data))
      console.log('💾 Datos guardados en caché para semana:', dateRange.start.toISOString().split('T')[0])
    } catch (error) {
      console.error('❌ Error guardando caché:', error)
    }
  }

  // SINGLE useEffect to load data
  useEffect(() => {
    let isMounted = true // Cleanup flag to prevent state updates after unmount

    const loadWeekData = async () => {
      if (!isMounted) return

      console.log('🔄 Cargando datos para semana:', currentWeek.toISOString().split('T')[0])
      setLoading(true)
      setError(null)

      try {
        const startDate = currentWeek
        const endDate = endOfWeek(currentWeek, { weekStartsOn: 1 })
        const dateRangeObj = { start: startDate, end: endDate }

        // Verificar caché primero
        const cachedData = getFromCache(dateRangeObj)
        if (cachedData && isMounted) {
          setEvents(cachedData.events)
          setLoading(false)
          console.log('✅ Datos cargados desde caché exitosamente')
          return
        }

        console.log('🌐 No hay caché, cargando desde servidor...')

        // Cargar eventos del calendario
        const startDateStr = startDate.toISOString().split('T')[0]
        const endDateStr = endDate.toISOString().split('T')[0]
        const eventsResponse = await fetch(`/api/postgres/calendar/events?startDate=${startDateStr}&endDate=${endDateStr}&limit=1000`)

        if (!isMounted) return

        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json()
          if (eventsData.success && eventsData.data && isMounted) {
            const formattedEvents = eventsData.data.map((event: any) => ({
              ...event,
              dia: new Date(event.dia),
              inscritos: 0 // Inicializar en 0
            }))

            setEvents(formattedEvents)

            // Cargar inscripciones después
            const eventIds = eventsData.data.map((event: any) => event._id)
            if (eventIds.length > 0 && isMounted) {
              await loadInscriptions(eventIds, formattedEvents, dateRangeObj)
            }
          }
        }

        if (isMounted) {
          setLoading(false)
        }

      } catch (error) {
        if (isMounted) {
          console.error('Error cargando datos:', error)
          setError('Error al cargar los datos')
          setLoading(false)
        }
      }
    }

    const loadInscriptions = async (eventIds: string[], eventsData: CalendarEvent[], dateRangeObj: {start: Date, end: Date}) => {
      if (!isMounted) return

      try {
        console.log('🔍 Cargando inscripciones para', eventIds.length, 'eventos')
        setBatchProcessing(true)

        const batchSize = 10
        const totalBatches = Math.ceil(eventIds.length / batchSize)
        const allInscritosCounts: { [key: string]: number } = {}

        for (let i = 0; i < eventIds.length; i += batchSize) {
          if (!isMounted) return

          const batchIds = eventIds.slice(i, i + batchSize)
          const currentBatch = Math.floor(i / batchSize) + 1

          setBatchProgress({
            current: currentBatch,
            total: totalBatches,
            eventsInBatch: batchIds.length
          })

          console.log(`🔍 Procesando batch ${currentBatch}/${totalBatches} con ${batchIds.length} eventos`)

          const inscripcionesResponse = await fetch('/api/postgres/events/batch-counts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventIds: batchIds })
          })

          if (inscripcionesResponse.ok) {
            const batchData = await inscripcionesResponse.json()
            if (batchData.success && batchData.inscritosCounts) {
              Object.assign(allInscritosCounts, batchData.inscritosCounts)
            }
          }

          // Pequeña pausa entre batches
          if (i + batchSize < eventIds.length) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }

        if (isMounted) {
          // Actualizar eventos con inscripciones
          const updatedEvents = eventsData.map(event => ({
            ...event,
            inscritos: allInscritosCounts[event._id] || 0
          }))

          setEvents(updatedEvents)

          // Guardar en caché
          if (updatedEvents.length > 0) {
            saveToCache(dateRangeObj, updatedEvents)
            console.log('💾 Caché guardado exitosamente con', updatedEvents.length, 'eventos')
          }
        }

      } catch (error) {
        console.error('Error cargando inscripciones:', error)
      } finally {
        if (isMounted) {
          setBatchProcessing(false)
          setBatchProgress(null)
        }
      }
    }

    loadWeekData()

    // Cleanup function
    return () => {
      isMounted = false
    }
  }, [currentWeek]) // ONLY currentWeek as dependency

  // Load advisors on mount
  useEffect(() => {
    const loadAdvisors = async () => {
      try {
        const response = await fetch('/api/postgres/guias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
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

    loadAdvisors()
  }, [])

  // Filter events based on criteria
  useEffect(() => {
    let filtered = events

    // Filter by date range
    if (filterDateFrom) {
      const fromDate = new Date(filterDateFrom)
      fromDate.setHours(0, 0, 0, 0)
      filtered = filtered.filter(event => event.dia >= fromDate)
    }

    if (filterDateTo) {
      const toDate = new Date(filterDateTo)
      toDate.setHours(23, 59, 59, 999)
      filtered = filtered.filter(event => event.dia <= toDate)
    }

    // Filter by advisor
    if (filterAdvisor) {
      filtered = filtered.filter(event => {
        if (typeof event.advisor === 'string') {
          return event.advisor === filterAdvisor
        }
        if (typeof event.advisor === 'object' && event.advisor._id) {
          return event.advisor._id === filterAdvisor
        }
        return false
      })
    }

    setFilteredEvents(filtered)
  }, [events, filterDateFrom, filterDateTo, filterAdvisor])

  // Clear filters function
  const clearFilters = () => {
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterAdvisor('')
  }

  // Helper functions
  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return filteredEvents.filter(event => isSameDay(event.dia, date))
  }

  const getEventsForHour = (date: Date, hour: number): CalendarEvent[] => {
    return getEventsForDay(date).filter(event => {
      const eventHour = getHours(event.dia)
      return eventHour === hour
    })
  }

  const handlePrevWeek = () => {
    setCurrentWeek(prev => subWeeks(prev, 1))
  }

  const handleNextWeek = () => {
    setCurrentWeek(prev => addWeeks(prev, 1))
  }

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setIsDetailModalOpen(true)
  }

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'SESSION': return 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200'
      case 'CLUB': return 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200'
      case 'WELCOME': return 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200'
    }
  }

  if (loading && events.length === 0) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">Agenda Académica</h1>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Cargando eventos de la semana...</p>
              {batchProcessing && batchProgress && (
                <p className="text-sm text-gray-500 mt-2">
                  Procesando inscripciones: {batchProgress.current}/{batchProgress.total} batches
                </p>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">Agenda Académica</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.VER}>
        <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Agenda Académica</h1>
          <div className="flex items-center space-x-4">
            <button
              onClick={handlePrevWeek}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium"
            >
              ← Semana anterior
            </button>
            <span className="text-lg font-medium">
              {format(currentWeek, 'MMM d', { locale: es })} - {format(endOfWeek(currentWeek, { weekStartsOn: 1 }), 'MMM d, yyyy', { locale: es })}
            </span>
            <button
              onClick={handleNextWeek}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium"
            >
              Semana siguiente →
            </button>
          </div>
        </div>

        {/* Filters Section */}
        <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Filtros</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportToExcel(filteredEvents, [
                  { header: 'Fecha', accessor: (e) => format(e.dia, 'yyyy-MM-dd') },
                  { header: 'Hora', accessor: (e) => format(e.dia, 'HH:mm') },
                  { header: 'Tipo', accessor: (e) => e.evento || e.tipo || '' },
                  { header: 'Nivel', accessor: (e) => e.tituloONivel },
                  { header: 'Evento', accessor: (e) => e.nombreEvento || '' },
                  { header: 'Advisor', accessor: (e) => e.advisorNombreCompleto || e.advisorNombre || (typeof e.advisor === 'object' ? `${e.advisor.primerNombre} ${e.advisor.primerApellido}` : e.advisor) || '' },
                  { header: 'Inscritos', accessor: (e) => e.inscritos || 0 },
                  { header: 'Limite', accessor: (e) => e.limiteUsuarios },
                  { header: 'Zoom', accessor: (e) => e.linkZoom || '' },
                ], `agenda-academica-${new Date().toISOString().split('T')[0]}`)}
                disabled={filteredEvents.length === 0}
                className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50"
              >
                Exportar Excel
              </button>
              <button
                onClick={clearFilters}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md text-gray-700"
              >
                Limpiar filtros
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Filter by date from */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha desde
              </label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Filter by date to */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha hasta
              </label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Filter by advisor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Advisor
              </label>
              <select
                value={filterAdvisor}
                onChange={(e) => setFilterAdvisor(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todos los advisors</option>
                {advisors.map((advisor) => (
                  <option key={advisor._id} value={advisor._id}>
                    {advisor.primerNombre} {advisor.primerApellido}
                  </option>
                ))}
              </select>
            </div>

            {/* Results count */}
            <div className="flex items-end">
              <div className="bg-blue-50 px-3 py-2 rounded-md">
                <div className="text-sm text-blue-600 font-medium">
                  Eventos: {filteredEvents.length}/{events.length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Loading indicator for batch processing - positioned above table */}
        {batchProcessing && batchProgress && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-3"></div>
              <span className="text-blue-800">
                Cargando inscripciones: {batchProgress.current}/{batchProgress.total} batches
                ({batchProgress.eventsInBatch} eventos en este batch)
              </span>
            </div>
          </div>
        )}

        {/* Weekly Calendar Grid */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="grid grid-cols-8 divide-x divide-gray-200">
            {/* Hour labels */}
            <div className="bg-gray-50 p-3">
              <div className="text-sm font-medium text-gray-500">Hora</div>
            </div>

            {/* Day headers */}
            {dateRange.map((date, index) => (
              <div key={index} className={`p-3 text-center ${isToday(date) ? 'bg-blue-50' : 'bg-gray-50'}`}>
                <div className="text-sm font-medium text-gray-900">
                  {format(date, 'EEE', { locale: es })}
                </div>
                <div className={`text-lg font-semibold flex items-center justify-center gap-1 ${isToday(date) ? 'text-blue-600' : 'text-gray-700'}`}>
                  {format(date, 'd')}
                  <HolidayBadge date={date} size="xs" placement="bottom" />
                </div>
              </div>
            ))}
          </div>

          {/* Time slots */}
          <div className="divide-y divide-gray-200">
            {hours.map((hour) => (
              <div key={hour} className="grid grid-cols-8 divide-x divide-gray-200 min-h-[80px]">
                {/* Hour label */}
                <div className="bg-gray-50 p-3 text-center">
                  <span className="text-sm text-gray-500">
                    {format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')}
                  </span>
                </div>

                {/* Day cells */}
                {dateRange.map((date, dayIndex) => {
                  const eventsForHour = getEventsForHour(date, hour)
                  return (
                    <div key={dayIndex} className={`p-2 ${isToday(date) ? 'bg-blue-25' : ''}`}>
                      {eventsForHour.map((event) => (
                        <div
                          key={event._id}
                          onClick={() => handleEventClick(event)}
                          className={`text-xs p-2 rounded-md border mb-1 cursor-pointer transition-colors ${getEventColor(event.evento || event.tipo || '')}`}
                        >
                          <div className="font-medium truncate">
                            {(event.evento || event.tipo) === 'CLUB' ? 'TALLER' : (event.evento || event.tipo)} - {event.tituloONivel}
                          </div>
                          {event.nombreEvento && (
                            <div className="truncate opacity-75">
                              {event.nombreEvento}
                            </div>
                          )}
                          <div className="text-xs opacity-75 mt-1">
                            👥 {event.inscritos || 0}/{event.limiteUsuarios}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>


        {/* Summary */}
        <div className="mt-6 bg-gray-50 rounded-lg p-4">
          <h3 className="text-lg font-medium mb-2">Resumen {filterDateFrom || filterDateTo || filterAdvisor ? '(Filtrado)' : 'de la semana'}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'SESSION').length}
              </div>
              <div className="text-sm text-gray-600">Sessions</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'CLUB').length}
              </div>
              <div className="text-sm text-gray-600">Clubs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {filteredEvents.filter(e => (e.evento || e.tipo) === 'WELCOME').length}
              </div>
              <div className="text-sm text-gray-600">Welcome Events</div>
            </div>
          </div>
        </div>

        {/* Modal de detalles del evento */}
        {selectedEvent && (
          <EventDetailModal
            event={selectedEvent}
            isOpen={isDetailModalOpen}
            onClose={() => {
              setIsDetailModalOpen(false)
              setSelectedEvent(null)
            }}
            advisors={advisors}
          />
        )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}