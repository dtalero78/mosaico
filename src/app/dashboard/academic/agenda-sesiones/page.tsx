'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import CalendarView from '@/components/calendar/CalendarView'
import DailyAgenda from '@/components/calendar/DailyAgenda'
import EventModal from '@/components/calendar/EventModal'
import EventDetailModal from '@/components/academic/EventDetailModal'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isWeekend, startOfDay, endOfDay, getDay, startOfWeek, endOfWeek, isWithinInterval, getWeek } from 'date-fns'
import { es } from 'date-fns/locale'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB' | 'WELCOME' | 'NIVELACION'
  tipo?: string
  tituloONivel: string
  nombreEvento?: string
  nivel?: string
  step?: string
  advisor: string | Advisor
  advisorNombre?: string
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
}

// Caché en memoria a nivel de módulo: sobrevive navegaciones dentro de la misma pestaña.
// Sin límite de tamaño, sin serialización, acceso instantáneo.
interface SessionCacheEntry {
  events: CalendarEvent[]
  advisors: Advisor[]
  timestamp: number
}
const SESSION_CACHE = new Map<string, SessionCacheEntry>()
const SESSION_CACHE_TTL = 5 * 60 * 1000 // 5 min (antes 4h — evita ver datos viejos tras cambios)
// v2: versionar la clave invalida los cachés viejos (ej. meses cacheados vacíos antes
// de generar los eventos de campaña). Subir el sufijo fuerza recarga desde el servidor.
const CACHE_KEY_PREFIX = 'agenda_sesiones_v2_'

export default function AgendaSesionesPage() {
  // Estados principales
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shouldUpdateInscritos, setShouldUpdateInscritos] = useState<{eventIds: string[], advisorsData: Advisor[]} | null>(null)

  // Estados para el loader de batch processing
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number, eventsInBatch: number} | null>(null)

  // Constantes para el caché (local dentro del componente)
  const CACHE_TTL = SESSION_CACHE_TTL

  // Función para obtener rango visible en calendario
  const getVisibleDateRange = (currentDate: Date) => {
    const firstVisible = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 })
    const lastVisible = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 })
    return { firstVisible, lastVisible }
  }

  // Estados del calendario
  const [view, setView] = useState<'calendar' | 'agenda'>('calendar')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  // Estados del modal
  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  // Modal eliminar evento con confirmación (Ctrl Horas hook)
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null)
  // Si el evento a eliminar pertenece a un grupo compartido, aquí se cargan
  // los hermanos para preguntar al admin si quiere borrarlos también.
  const [deleteGroupSiblings, setDeleteGroupSiblings] = useState<any[]>([])
  const [deleteGroupChecked, setDeleteGroupChecked] = useState(false)
  // Modo de eliminación del evento (mutuamente excluyente):
  //   'suspension'      → registra snapshot en ADVISOR_EVENT_LOG (Ctrl Horas)
  //   'restructuracion' → borrado limpio, NO deja registro en el log
  //   null              → ninguna casilla marcada (botón Eliminar deshabilitado)
  const [deleteMode, setDeleteMode] = useState<'suspension' | 'restructuracion' | null>(null)
  const [deleteMotivo, setDeleteMotivo] = useState('')
  const [deletingEvent, setDeletingEvent] = useState(false)

  // Estados para el modal de detalles
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedEventForDetail, setSelectedEventForDetail] = useState<CalendarEvent | null>(null)

  // Funciones de caché
  const getCacheKey = (month: Date) => {
    return `${CACHE_KEY_PREFIX}${month.getFullYear()}_${String(month.getMonth()).padStart(2, '0')}`
  }

  const getFromCache = (month: Date) => {
    const cacheKey = getCacheKey(month)
    const now = Date.now()

    // 1. Primero chequear caché en memoria (instantáneo, sin serialización)
    const sessionEntry = SESSION_CACHE.get(cacheKey)
    if (sessionEntry && now - sessionEntry.timestamp < CACHE_TTL) {
      console.log('⚡ Datos cargados desde caché en memoria para:', month.toISOString().split('T')[0])
      return { events: sessionEntry.events, advisors: sessionEntry.advisors }
    }

    // 2. Fallback: localStorage (persiste entre recargas)
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const data = JSON.parse(cached)
        if (now - data.timestamp < CACHE_TTL) {
          const eventsWithDates = data.events.map((event: any) => ({
            ...event,
            dia: new Date(event.dia)
          }))
          // Promover al caché en memoria para próximos accesos
          SESSION_CACHE.set(cacheKey, { events: eventsWithDates, advisors: data.advisors, timestamp: data.timestamp })
          console.log('📦 Datos cargados desde localStorage para:', month.toISOString().split('T')[0])
          return { events: eventsWithDates, advisors: data.advisors }
        } else {
          localStorage.removeItem(cacheKey)
          console.log('🗑️ Caché localStorage expirado eliminado para:', month.toISOString().split('T')[0])
        }
      }
    } catch (error) {
      console.error('❌ Error leyendo localStorage:', error)
    }
    return null
  }

  const saveToCache = (month: Date, events: CalendarEvent[], advisors: Advisor[]) => {
    const cacheKey = getCacheKey(month)
    const timestamp = Date.now()

    // Siempre guardar en memoria (sin límite de tamaño)
    SESSION_CACHE.set(cacheKey, { events, advisors, timestamp })
    console.log('⚡ Datos guardados en caché en memoria para:', month.toISOString().split('T')[0])

    // Intentar guardar en localStorage como respaldo (puede fallar si hay muchos eventos)
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp, events, advisors }))
    } catch {
      // localStorage lleno o bloqueado — el caché en memoria es suficiente para esta sesión
    }
  }

  const clearAllCache = () => {
    SESSION_CACHE.clear()
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CACHE_KEY_PREFIX)) keysToRemove.push(key)
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch { /* ignorar */ }
  }

  // Invalidar caché del mes afectado (en memoria + localStorage)
  const clearCacheForMonth = (eventDate: Date) => {
    const cacheKey = getCacheKey(eventDate)
    SESSION_CACHE.delete(cacheKey)
    try {
      localStorage.removeItem(cacheKey)
    } catch { /* ignorar */ }
    console.log('🗑️ Caché invalidado para:', eventDate.toISOString().split('T')[0])
  }

  const clearExpiredCache = () => {
    const now = Date.now()

    // Limpiar caché en memoria expirado
    SESSION_CACHE.forEach((entry, key) => {
      if (now - entry.timestamp >= CACHE_TTL) {
        SESSION_CACHE.delete(key)
      }
    })

    // Limpiar localStorage expirado
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CACHE_KEY_PREFIX)) {
          const cached = localStorage.getItem(key)
          if (cached) {
            const data = JSON.parse(cached)
            if (now - data.timestamp >= CACHE_TTL) keysToRemove.push(key)
          }
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch { /* ignorar */ }
  }

  // Cargar datos iniciales
  useEffect(() => {
    loadInitialDataWithCache()
  }, [])

  // Recargar eventos cuando cambia el mes (basta con tener advisors/guías cargados).
  // NOTA: antes exigía además `events.length > 0`, lo que rompía la navegación cuando
  // el mes inicial no tenía eventos (ej. campañas que empiezan meses después) — el
  // array quedaba vacío y ningún otro mes volvía a cargar.
  useEffect(() => {
    if (advisors.length > 0) {
      console.log('🔄 Mes cambió, verificando caché para:', currentMonth.toISOString().split('T')[0])
      loadMonthEventsWithCache()
    }
  }, [currentMonth])

  // Effect para actualizar inscripciones con lógica de prioridad
  useEffect(() => {
    if (shouldUpdateInscritos) {
      console.log('🎯 Frontend: useEffect disparado, cargando con prioridad...')
      loadEventsWithPriority(shouldUpdateInscritos.eventIds)
    }
  }, [shouldUpdateInscritos])

  // Nueva función: Cargar eventos con prioridad (visible primero, resto en background)
  const loadEventsWithPriority = async (eventIds: string[]) => {
    try {
      // 1. Obtener todos los eventos actuales
      const allEvents = events

      // 2. Separar eventos por prioridad basado en rango visible
      const visibleRange = getVisibleDateRange(currentMonth)

      const priorityEvents: string[] = []
      const backgroundEvents: string[] = []

      eventIds.forEach(eventId => {
        const event = allEvents.find(e => e._id === eventId)
        if (event && isWithinInterval(event.dia, { start: visibleRange.firstVisible, end: visibleRange.lastVisible })) {
          priorityEvents.push(eventId)
        } else {
          backgroundEvents.push(eventId)
        }
      })

      console.log(`📊 Separación de eventos: ${priorityEvents.length} prioritarios, ${backgroundEvents.length} background`)

      // 3. Cargar inscritos de eventos prioritarios PRIMERO (usuario ve datos rápido)
      if (priorityEvents.length > 0) {
        await updateInscripciones(priorityEvents, true) // isPriority = true
      }

      // 4. Cargar resto en background sin bloquear (sin await)
      if (backgroundEvents.length > 0) {
        updateInscripciones(backgroundEvents, false).then(() => {
          console.log('✅ Carga completa de background finalizada')
        })
      }

      // Limpiar el trigger
      setShouldUpdateInscritos(null)

    } catch (error) {
      console.error('❌ Error en carga con prioridad:', error)
      setShouldUpdateInscritos(null)
    }
  }

  const updateInscripciones = async (eventIds: string[], isPriority: boolean = false) => {
    const typeLabel = isPriority ? 'PRIORITARIOS' : 'BACKGROUND'
    try {
      console.log(`🔄 Frontend: Actualizando inscripciones ${typeLabel} para`, eventIds.length, 'eventos')

      // Solo mostrar loader para eventos prioritarios
      if (isPriority) {
        setBatchProcessing(true)
      }

      // Batch size más grande para mejor rendimiento (50 para prioritarios, 100 para background)
      const batchSize = isPriority ? 50 : 100
      const totalBatches = Math.ceil(eventIds.length / batchSize)
      const allInscritosCounts: { [key: string]: number } = {}
      const allAsistenciasCounts: { [key: string]: number } = {}

      for (let i = 0; i < eventIds.length; i += batchSize) {
        const batchIds = eventIds.slice(i, i + batchSize)
        const currentBatch = Math.floor(i / batchSize) + 1

        // Actualizar progreso del loader solo para prioritarios
        if (isPriority) {
          setBatchProgress({
            current: currentBatch,
            total: totalBatches,
            eventsInBatch: batchIds.length
          })
        }

        console.log(`📦 ${typeLabel}: Procesando batch ${currentBatch}/${totalBatches} con ${batchIds.length} eventos`)

        const inscripcionesResponse = await fetch('/api/postgres/events/batch-counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventIds: batchIds })
        })

        if (inscripcionesResponse.ok) {
          const inscripcionesData = await inscripcionesResponse.json()
          if (inscripcionesData.success && inscripcionesData.inscritosCounts) {
            Object.assign(allInscritosCounts, inscripcionesData.inscritosCounts)
          }
          if (inscripcionesData.success && inscripcionesData.asistenciasCounts) {
            Object.assign(allAsistenciasCounts, inscripcionesData.asistenciasCounts)
          }
        } else {
          console.log(`❌ Error en batch ${currentBatch}:`, inscripcionesResponse.status)
        }

        // Sin pausas entre batches para máximo rendimiento
      }

      // Contar total de inscripciones y asistencias
      const totalInscripciones = Object.values(allInscritosCounts).reduce((sum: number, count: number) => sum + count, 0)
      const totalAsistencias = Object.values(allAsistenciasCounts).reduce((sum: number, count: number) => sum + count, 0)
      console.log(`📊 ${typeLabel}: Inscripciones cargadas: ${totalInscripciones} total en ${Object.keys(allInscritosCounts).length} eventos`)
      console.log(`✅ ${typeLabel}: Asistencias cargadas: ${totalAsistencias} total en ${Object.keys(allAsistenciasCounts).length} eventos`)

      // Actualizar eventos existentes con inscripciones y asistencias reales
      setEvents(currentEvents => {
        const updatedEvents = currentEvents.map(event => ({
          ...event,
          inscritos: allInscritosCounts[event._id] !== undefined ? allInscritosCounts[event._id] : event.inscritos,
          asistieron: allAsistenciasCounts[event._id] !== undefined ? allAsistenciasCounts[event._id] : event.asistieron
        }))

        // Log solo si hay eventos con inscripciones para debug
        const eventosConInscripciones = updatedEvents.filter(event => (event.inscritos ?? 0) > 0)
        if (eventosConInscripciones.length > 0 && isPriority) {
          console.log(`📊 Eventos con inscripciones encontrados: ${eventosConInscripciones.length}`)
        }

        return updatedEvents
      })

      console.log(`✅ Frontend: Eventos ${typeLabel} actualizados con inscripciones`)

      // Guardar en caché después de cada fase (priority y background)
      setEvents(currentEvents => {
        if (currentEvents.length > 0 && advisors.length > 0) {
          saveToCache(currentMonth, currentEvents, advisors)
          console.log(`💾 Caché actualizado después de fase ${isPriority ? 'PRIORITY' : 'BACKGROUND'}`)
        }
        return currentEvents
      })

    } catch (error) {
      console.error(`❌ Frontend: Error cargando inscripciones ${typeLabel}:`, error)
    } finally {
      // Desactivar loader solo si era prioritario
      if (isPriority) {
        setBatchProcessing(false)
        setBatchProgress(null)
      }
    }
  }

  // Cargar eventos de un mes específico con caché
  const loadMonthEventsWithCache = async () => {
    if (!advisors.length) return // Solo cargar si ya tenemos advisors

    try {
      // Verificar caché primero
      const cachedData = getFromCache(currentMonth)

      if (cachedData) {
        // Usar datos del caché
        setEvents(cachedData.events)
        console.log('✅ 📦 CACHÉ HIT - Eventos del mes cargados desde caché')
        console.log(`   → ${cachedData.events.length} eventos para ${currentMonth.toLocaleDateString('es-ES', {month: 'long', year: 'numeric'})}`)
        // Refrescar inscritos en background para evitar datos stale
        const eventIds = cachedData.events.map((e: any) => e._id)
        if (eventIds.length > 0) {
          setShouldUpdateInscritos({ eventIds, advisorsData: advisors })
        }
        return
      }

      // Si no hay caché, cargar desde servidor
      console.log('🌐 ⚠️ CACHÉ MISS - Cargando eventos del mes desde servidor...')
      await loadMonthEvents()

    } catch (error) {
      console.error('Error cargando eventos del mes:', error)
    }
  }

  // Cargar eventos de un mes específico desde servidor
  const loadMonthEvents = async () => {
    try {
      console.log('🗓️ Cargando eventos para:', currentMonth.toISOString().split('T')[0])

      // Función local para obtener advisor name - ahora usa campos del JOIN
      const getAdvisorNameLocal = (event: any): string => {
        // Primero intentar con los nuevos campos del JOIN
        if (event.advisorNombreCompleto) {
          return event.advisorNombreCompleto
        }
        if (event.advisorPrimerNombre) {
          return `${event.advisorPrimerNombre} ${event.advisorPrimerApellido || ''}`.trim()
        }
        // Fallback al método anterior por compatibilidad
        const advisor = event.advisor
        if (advisor && typeof advisor === 'object' && advisor.primerNombre) {
          return `${advisor.primerNombre} ${advisor.primerApellido || ''}`.trim()
        }
        if (advisor && typeof advisor === 'string') {
          const advisorObj = advisors.find((a: any) => a._id === advisor)
          return advisorObj ? `${advisorObj.primerNombre} ${advisorObj.primerApellido}` : 'Sin asignar'
        }
        return 'Sin asignar'
      }

      // Calcular el rango completo del calendario (incluyendo días del mes anterior y siguiente)
      const monthStart = startOfMonth(currentMonth)
      const monthEnd = endOfMonth(currentMonth)

      // Extender el rango para incluir los días mostrados de meses adyacentes
      const calendarStart = new Date(monthStart)
      const dayOfWeek = calendarStart.getDay()
      if (dayOfWeek !== 0) {
        calendarStart.setDate(monthStart.getDate() - dayOfWeek)
      }

      const calendarEnd = new Date(monthEnd)
      const endDayOfWeek = calendarEnd.getDay()
      if (endDayOfWeek !== 6) {
        calendarEnd.setDate(monthEnd.getDate() + (6 - endDayOfWeek))
      }

      // Use PostgreSQL calendar endpoint
      const startDateStr = format(startOfDay(calendarStart), 'yyyy-MM-dd')
      const endDateStr = format(endOfDay(calendarEnd), 'yyyy-MM-dd')
      const eventsResponse = await fetch(`/api/postgres/calendar/events?startDate=${startDateStr}&endDate=${endDateStr}`)

      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json()
        if (eventsData.success && eventsData.data) {
          const basicEvents = eventsData.data.map((event: any) => ({
            ...event,
            dia: new Date(event.dia),
            inscritos: 0, // Inicializar en 0
            asistieron: 0, // Inicializar en 0
            advisorNombre: getAdvisorNameLocal(event)
          }))
          setEvents(basicEvents)

          // Triggear la carga de inscripciones y asistencias
          const eventIds = eventsData.data.map((event: any) => event._id)
          console.log('🚀 Cargando inscripciones + asistencias para nuevo mes:', eventIds.length, 'eventos')
          setShouldUpdateInscritos({ eventIds, advisorsData: advisors })
        }
      }
    } catch (error) {
      console.error('Error cargando eventos del mes:', error)
    }
  }

  // Cargar datos iniciales con caché
  const loadInitialDataWithCache = async () => {
    setLoading(true)
    clearExpiredCache() // Limpiar cachés expirados al iniciar

    try {
      const now = new Date()

      // Intentar cargar desde caché primero
      const cachedData = getFromCache(now)

      if (cachedData) {
        // Usar datos del caché
        setAdvisors(cachedData.advisors)
        setEvents(cachedData.events)
        setLoading(false)
        console.log('✅ 📦 CACHÉ HIT - Datos cargados desde caché exitosamente')
        console.log(`   → ${cachedData.events.length} eventos, ${cachedData.advisors.length} advisors`)
        // Refrescar inscritos en background para evitar datos stale
        const eventIds = cachedData.events.map((e: any) => e._id)
        if (eventIds.length > 0) {
          setShouldUpdateInscritos({ eventIds, advisorsData: cachedData.advisors })
        }
        return
      }

      // Si no hay caché, cargar desde servidor
      console.log('🌐 Cargando datos desde servidor...')
      await loadInitialData(now)

    } catch (error) {
      console.error('Error cargando datos:', error)
      setError('Error al cargar los datos')
      setLoading(false)
    }
  }

  // Cargar datos desde servidor
  const loadInitialData = async (targetDate: Date = new Date()) => {
    try {
      // Cargar advisors from PostgreSQL
      const advisorsResponse = await fetch('/api/postgres/guias')

      let advisorsData: Advisor[] = []
      if (advisorsResponse.ok) {
        const advisorsResult = await advisorsResponse.json()
        // API puede devolver "advisors" o "data"
        const advisorsArray = advisorsResult.advisors || advisorsResult.data || []
        if (advisorsResult.success && advisorsArray.length > 0) {
          advisorsData = advisorsArray
          setAdvisors(advisorsData)
        }
      }

      // Cargar eventos del mes objetivo - extender el rango para incluir días de meses adyacentes
      const monthStart = startOfMonth(targetDate)
      const monthEnd = endOfMonth(targetDate)

      // Calcular el rango completo del calendario
      const calendarStart = new Date(monthStart)
      const dayOfWeek = calendarStart.getDay()
      if (dayOfWeek !== 0) {
        calendarStart.setDate(monthStart.getDate() - dayOfWeek)
      }

      const calendarEnd = new Date(monthEnd)
      const endDayOfWeek = calendarEnd.getDay()
      if (endDayOfWeek !== 6) {
        calendarEnd.setDate(monthEnd.getDate() + (6 - endDayOfWeek))
      }

      // Use PostgreSQL calendar endpoint
      const startDateStr = format(startOfDay(calendarStart), 'yyyy-MM-dd')
      const endDateStr = format(endOfDay(calendarEnd), 'yyyy-MM-dd')
      const eventsResponse = await fetch(`/api/postgres/calendar/events?startDate=${startDateStr}&endDate=${endDateStr}`)

      // Función local para obtener advisor name - ahora usa campos del JOIN
      const getAdvisorNameLocal = (event: any): string => {
        // Primero intentar con los nuevos campos del JOIN
        if (event.advisorNombreCompleto) {
          return event.advisorNombreCompleto
        }
        if (event.advisorPrimerNombre) {
          return `${event.advisorPrimerNombre} ${event.advisorPrimerApellido || ''}`.trim()
        }
        // Fallback al método anterior por compatibilidad
        const advisor = event.advisor
        if (advisor && typeof advisor === 'object' && advisor.primerNombre) {
          return `${advisor.primerNombre} ${advisor.primerApellido || ''}`.trim()
        }
        if (advisor && typeof advisor === 'string') {
          const advisorObj = advisorsData.find((a: any) => a._id === advisor)
          return advisorObj ? `${advisorObj.primerNombre} ${advisorObj.primerApellido}` : 'Sin asignar'
        }
        return 'Sin asignar'
      }

      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json()
        if (eventsData.success && eventsData.data) {
          // Primero, cargar eventos con datos básicos
          const basicEvents = eventsData.data.map((event: any) => ({
            ...event,
            dia: new Date(event.dia),
            inscritos: 0, // Inicializar en 0
            asistieron: 0, // Inicializar en 0
            advisorNombre: getAdvisorNameLocal(event)
          }))
          setEvents(basicEvents)

          // Después, triggear la carga de inscripciones y asistencias usando useEffect
          const eventIds = eventsData.data.map((event: any) => event._id)
          console.log('🚀 Frontend: Triggering inscripciones + asistencias update para', eventIds.length, 'eventos')
          setShouldUpdateInscritos({ eventIds, advisorsData })
        }
      }

      setLoading(false)

    } catch (error) {
      console.error('Error cargando datos:', error)
      setError('Error al cargar los datos')
      setLoading(false)
    }
  }

  // Obtener nombre del advisor
  const getAdvisorName = (advisor: string | Advisor): string => {
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

  // Funciones del calendario
  const handleMonthChange = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
    // El useEffect de la línea 162 se encargará de cargar eventos cuando cambie currentMonth
  }

  const handleDayClick = (date: Date) => {
    setSelectedDate(date)
    setView('agenda')

    // Si el día clickeado es de otro mes, cambiar el mes actual
    if (!isSameMonth(date, currentMonth)) {
      setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  const handleCreateEvent = (date?: Date) => {
    setEditingEvent(null)
    // Si se pasa una fecha específica, usarla; si no, usar selectedDate o fecha actual
    if (date) {
      setSelectedDate(date)
    } else if (!selectedDate) {
      setSelectedDate(new Date())
    }
    setShowEventModal(true)
  }

  const handleViewEventDetail = (event: CalendarEvent) => {
    setSelectedEventForDetail(event)
    setShowDetailModal(true)
  }

  const handleEditEvent = (event: CalendarEvent) => {
    setEditingEvent(event)
    setShowEventModal(true)
  }

  // Estado para modal de eliminación con confirmación (Ctrl Horas hook).
  // Si el evento pertenece a un grupo compartido (eventoCompartidoId), también
  // cargamos los hermanos para que el admin pueda elegir borrarlos en cascada.
  const handleDeleteEvent = async (eventId: string) => {
    const ev = events.find(e => e._id === eventId)
    if (!ev) return
    setDeleteTarget(ev)
    setDeleteMode(null)
    setDeleteMotivo('')
    setDeleteGroupSiblings([])
    setDeleteGroupChecked(false)
    // Fire-and-forget — si falla, simplemente no se muestra la sección de grupo.
    try {
      const res = await fetch(`/api/postgres/events/${eventId}/group`)
      if (res.ok) {
        const data = await res.json()
        if (data?.isShared && Array.isArray(data.siblings)) {
          setDeleteGroupSiblings(data.siblings)
          // Default: borrar todo el grupo (operativamente es 1 sola clase).
          setDeleteGroupChecked(true)
        }
      }
    } catch { /* ignorar errores de red — el modal abre igual */ }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || !deleteMode) return
    setDeletingEvent(true)
    try {
      const qs = new URLSearchParams()
      if (deleteMotivo.trim()) qs.set('motivo', deleteMotivo.trim())
      // Restructuración: borrado limpio sin registro en ADVISOR_EVENT_LOG.
      // El backend honra skipLog=true para saltar el insert del snapshot.
      if (deleteMode === 'restructuracion') qs.set('skipLog', 'true')
      // Si es grupo compartido y el checkbox está marcado, pedimos al backend
      // borrar todos los hermanos en cascada (1 sola transacción).
      const isGroupDelete = deleteGroupSiblings.length > 1 && deleteGroupChecked
      if (isGroupDelete) qs.set('deleteGroup', 'true')
      const response = await fetch(`/api/postgres/events/${deleteTarget._id}?${qs.toString()}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const deletedIds = isGroupDelete
          ? new Set(deleteGroupSiblings.map((s: any) => s._id))
          : new Set([deleteTarget._id])
        const deletedEvent = events.find(e => e._id === deleteTarget._id)
        setEvents(prev => prev.filter(e => !deletedIds.has(e._id)))
        if (deletedEvent) clearCacheForMonth(deletedEvent.dia)
        setDeleteTarget(null)
        setDeleteGroupSiblings([])
        setDeleteGroupChecked(false)
      } else {
        const json = await response.json().catch(() => ({}))
        setError(json.error || 'Error al eliminar el evento')
      }
    } catch (error) {
      console.error('Error deleting event:', error)
      setError('Error al eliminar el evento')
    } finally {
      setDeletingEvent(false)
    }
  }

  const cancelDelete = () => {
    if (deletingEvent) return
    setDeleteTarget(null)
    setDeleteMode(null)
    setDeleteMotivo('')
  }

  const handleEventSave = async (eventData: any) => {
    try {
      if (editingEvent) {
        // Actualizar evento existente
        const response = await fetch(`/api/postgres/events/${editingEvent._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData)
        })

        if (response.ok) {
          const data = await response.json()
          setEvents(prev => prev.map(e => e._id === editingEvent._id ? { ...data.event, dia: new Date(data.event.dia) } : e))
          // Invalidar caché solo del mes afectado (en lugar de todo)
          clearCacheForMonth(new Date(data.event.dia))
          console.log('🗑️ Cache invalidado solo del mes afectado después de actualizar evento')
        } else {
          // Mostrar el error específico del backend (ValidationError, ConflictError, etc.)
          // en vez del mensaje genérico — ayuda al admin a entender qué falló.
          let serverMsg = ''
          try {
            const json = await response.json()
            serverMsg = json?.error || json?.message || ''
          } catch { /* response sin JSON válido */ }
          setError(serverMsg
            ? `Error al actualizar el evento: ${serverMsg}`
            : `Error al actualizar el evento (HTTP ${response.status})`)
        }
      } else {
        // Crear nuevo evento
        const response = await fetch('/api/postgres/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventData)
        })

        if (response.ok) {
          const data = await response.json()
          console.log('✅ Evento creado exitosamente:', data.event)

          // Agregar el evento al estado local con el formato correcto
          const newEvent = {
            ...data.event,
            dia: new Date(data.event.dia),
            inscritos: 0,
            asistieron: 0,
            advisorNombre: getAdvisorName(data.event.advisor)
          }

          setEvents(prev => {
            const updatedEvents = [...prev, newEvent]
            console.log('📊 Total eventos después de agregar:', updatedEvents.length)
            return updatedEvents
          })

          // Invalidar caché solo del mes afectado (en lugar de todo)
          clearCacheForMonth(new Date(data.event.dia))
          console.log('🗑️ Cache invalidado solo del mes afectado después de crear evento')

          // Recargar eventos del servidor para asegurar sincronización
          setTimeout(() => {
            console.log('🔄 Recargando eventos desde servidor...')
            loadMonthEvents()
          }, 1000)
        } else {
          setError('Error al crear el evento')
        }
      }

      setShowEventModal(false)
      setEditingEvent(null)
    } catch (error) {
      console.error('Error saving event:', error)
      setError('Error al guardar el evento')
    }
  }


  // Función para obtener el color según el tipo de evento
  const getEventColor = (tipo: string) => {
    switch (tipo) {
      case 'SESSION':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'CLUB':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'WELCOME':
        return 'bg-purple-100 text-purple-800 border-purple-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.CALENDARIO_VER}>
        <div className="space-y-6">
          {/* Header */}
        <div className="sm:flex sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📅 Calendario de Eventos</h1>
            <p className="mt-2 text-sm text-gray-700">
              Gestión completa de sesiones, talleres y eventos
            </p>
          </div>

          <div className="mt-4 flex gap-2 sm:mt-0">
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setView('calendar')}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  view === 'calendar'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                📅 Calendario
              </button>
              <button
                onClick={() => setView('agenda')}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  view === 'agenda'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                📋 Agenda
              </button>
            </div>

            <button
              onClick={() => handleCreateEvent()}
              className="btn btn-primary"
            >
              + Crear Evento
            </button>

            <button
              onClick={() => exportToExcel(events, [
                { header: 'Fecha', accessor: (e) => e.dia ? format(new Date(e.dia), 'dd/MM/yyyy') : '' },
                { header: 'Hora', accessor: (e) => e.dia ? format(new Date(e.dia), 'HH:mm') : '' },
                { header: 'Tipo', accessor: (e) => e.evento || e.tipo || '' },
                { header: 'Nivel', accessor: (e) => e.tituloONivel || e.nombreEvento || '' },
                { header: 'Guía', accessor: (e) => e.advisorNombre || getAdvisorName(e.advisor) },
                { header: 'Inscritos', accessor: (e) => e.inscritos ?? 0 },
                { header: 'Asistieron', accessor: (e) => e.asistieron ?? 0 },
                { header: 'Límite', accessor: (e) => e.limiteUsuarios },
                { header: 'Zoom', accessor: (e) => e.linkZoom },
              ], `agenda-sesiones-${format(currentMonth, 'yyyy-MM')}`)}
              disabled={events.length === 0}
              className="btn btn-secondary"
            >
              📥 Exportar Excel
            </button>
          </div>
        </div>

        {/* Contenido principal */}
        {loading ? (
          <div className="card">
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="text-center py-12">
              <div className="text-red-500 text-xl mb-4">⚠️</div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Error</h3>
              <p className="text-red-600">{error}</p>
              <button
                onClick={() => loadInitialData()}
                className="mt-4 btn btn-primary"
              >
                Reintentar
              </button>
            </div>
          </div>
        ) : batchProcessing ? (
          <div className="card">
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Cargando inscripciones...</h3>
              {batchProgress && (
                <p className="text-gray-600 text-center">
                  Procesando grupo {batchProgress.current}/{batchProgress.total} con {batchProgress.eventsInBatch} eventos
                </p>
              )}
              <div className="w-64 bg-gray-200 rounded-full h-2 mt-4">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: batchProgress ? `${(batchProgress.current / batchProgress.total) * 100}%` : '0%'
                  }}
                ></div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Información de resumen */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">📊</div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">Total Eventos</h3>
                    <p className="text-3xl font-bold text-primary-600">{events.length}</p>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">📚</div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">Sessions</h3>
                    <p className="text-3xl font-bold text-blue-600">
                      {events.filter(e => (e.evento || e.tipo) === 'SESSION').length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">🎯</div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">Talleres</h3>
                    <p className="text-3xl font-bold text-green-600">
                      {events.filter(e => (e.evento || e.tipo) === 'CLUB').length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex items-center">
                  <div className="text-2xl mr-3">👋</div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">Welcome</h3>
                    <p className="text-3xl font-bold text-purple-600">
                      {events.filter(e => (e.evento || e.tipo) === 'WELCOME').length}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Vista del calendario */}
            {view === 'calendar' ? (
              <CalendarView
                currentMonth={currentMonth}
                events={events}
                selectedDate={selectedDate}
                onDayClick={handleDayClick}
                onMonthChange={handleMonthChange}
              />
            ) : (
              <DailyAgenda
                selectedDate={selectedDate || new Date()}
                events={events}
                advisors={advisors}
                onViewDetail={handleViewEventDetail}
                onEditEvent={handleEditEvent}
                onDeleteEvent={handleDeleteEvent}
                onCreateEvent={handleCreateEvent}
                onDateChange={setSelectedDate}
              />
            )}
          </>
        )}

        {/* Modal para crear/editar evento */}
        {showEventModal && (
          <EventModal
            isOpen={showEventModal}
            onClose={() => {
              setShowEventModal(false)
              setEditingEvent(null)
            }}
            onSave={handleEventSave}
            editingEvent={editingEvent as any}
            advisors={advisors}
            selectedDate={selectedDate}
          />
        )}

        {/* Modal eliminar evento con checkbox de confirmación (Ctrl Horas hook) */}
        {deleteTarget && (() => {
          const adv = advisors.find(a => a._id === (deleteTarget as any).advisor)
          const advName = adv ? `${adv.primerNombre ?? ''} ${adv.primerApellido ?? ''}`.trim() : 'el advisor asignado'
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
              <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  ⚠️ Cancelar evento
                </h3>
                <p className="text-sm text-gray-700 mb-4">
                  Estás por <strong>eliminar</strong> este evento de <strong>{advName}</strong>.
                  Marca una opción para confirmar (mutuamente excluyentes):
                </p>

                {/* Evento compartido: opción de borrar todo el grupo en cascada */}
                {deleteGroupSiblings.length > 1 && (
                  <div className="mb-4 border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg p-3 text-sm">
                    <p className="text-indigo-900 mb-2">
                      🔗 <strong>Evento compartido entre {deleteGroupSiblings.length} niveles.</strong>
                    </p>
                    <ul className="text-xs text-indigo-800 mb-2 list-disc list-inside">
                      {deleteGroupSiblings.map((s: any) => (
                        <li key={s._id}>
                          {s.nivel || '—'}{s.nombreEvento ? ` · ${s.nombreEvento}` : (s.step ? ` · ${s.step}` : '')}
                          {s._id === deleteTarget._id && <span className="ml-1 text-indigo-600 font-medium">(este)</span>}
                        </li>
                      ))}
                    </ul>
                    <label className="flex items-start gap-2 cursor-pointer text-indigo-900">
                      <input
                        type="checkbox"
                        checked={deleteGroupChecked}
                        onChange={(e) => setDeleteGroupChecked(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs">
                        Eliminar también los otros {deleteGroupSiblings.length - 1} eventos del grupo
                        <span className="block text-indigo-700">
                          {deleteGroupChecked
                            ? 'Operativamente es 1 sola clase — borrar todos es lo natural.'
                            : 'Si lo desactivas, los hermanos quedan como eventos independientes.'}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {/* Opciones mutuamente excluyentes — sólo una puede estar marcada */}
                <div className="space-y-2 mb-4">
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={deleteMode === 'suspension'}
                      onChange={(e) => setDeleteMode(e.target.checked ? 'suspension' : null)}
                      className="mt-0.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-800">
                      Confirmación Suspensión de sesión para <strong>{advName}</strong>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Queda registrada en Ctrl Horas como sesión SUSPENDIDA.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={deleteMode === 'restructuracion'}
                      onChange={(e) => setDeleteMode(e.target.checked ? 'restructuracion' : null)}
                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-800">
                      Restructuración
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Borrado limpio: el evento se elimina pero <strong>NO queda registro</strong> de suspensión
                        en Ctrl Horas del advisor.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mb-4">
                  <label htmlFor="delete-motivo" className="block text-xs font-medium text-gray-700 mb-1">
                    Motivo (opcional)
                  </label>
                  <textarea
                    id="delete-motivo"
                    value={deleteMotivo}
                    onChange={(e) => setDeleteMotivo(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    placeholder="Ej: día festivo no laborable"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelDelete}
                    disabled={deletingEvent}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={!deleteMode || deletingEvent}
                    className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {deletingEvent && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    )}
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Modal para ver detalles del evento */}
        {showDetailModal && (
          <EventDetailModal
            event={selectedEventForDetail}
            isOpen={showDetailModal}
            onClose={() => {
              setShowDetailModal(false)
              setSelectedEventForDetail(null)
            }}
            advisors={advisors}
          />
        )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}