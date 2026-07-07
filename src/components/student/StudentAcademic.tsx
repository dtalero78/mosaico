'use client'

import { useState, useEffect } from 'react'
import { Student, Class } from '@/types'
import { formatDate, formatDateTime } from '@/lib/utils'
import { PlusIcon, PencilIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { usePermissions } from '@/hooks/usePermissions'
import { StudentPermission, Role } from '@/types/permissions'

interface StudentAcademicProps {
  student: Student
  classes: Class[]
  view?: 'attendance' | 'schedule' | 'steps'
}

export default function StudentAcademic({ student, classes: initialClasses, view = 'attendance' }: StudentAcademicProps) {
  const { data: session } = useSession()
  const { hasPermission, userRole } = usePermissions()
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [selectedClass, setSelectedClass] = useState<Class | null>(null)
  const [showClassModal, setShowClassModal] = useState(false)
  const [advisorName, setAdvisorName] = useState<string>('No asignado')
  const [advisorNames, setAdvisorNames] = useState<{[key: string]: string}>({})
  const [classes, setClasses] = useState<Class[]>(initialClasses)

  // Permisos para el modal de detalles de clase
  const canEvaluate = hasPermission(StudentPermission.EVALUACION)
  const canAddAdvisorNotes = hasPermission(StudentPermission.ANOTACION_ADVISOR)
  const canAddStudentComments = hasPermission(StudentPermission.COMENTARIOS_ESTUDIANTE)
  const canDeleteEvent = hasPermission(StudentPermission.ELIMINAR_EVENTO)

  // Solo COORDINADOR_ACADEMICO y SUPER_ADMIN pueden editar los campos de comentarios
  const canEditComments = userRole === Role.SUPER_ADMIN || userRole === Role.COORDINADOR_ACADEMICO

  // Bloqueo de agendamiento si el estudiante está INACTIVO en ACADEMICA — solo SUPER_ADMIN o ADMIN pueden continuar
  const isStudentInactive = student.estadoInactivo === true
  const canBypassInactive = userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN
  const blockSchedulingByInactive = isStudentInactive && !canBypassInactive

  // Filter states
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [attendanceFilter, setAttendanceFilter] = useState<'all' | 'attended' | 'not-attended'>('all')
  const [advisorFilter, setAdvisorFilter] = useState('')

  // Nueva Clase modal state
  const [selectedEventType, setSelectedEventType] = useState<'SESSION' | 'CLUB' | ''>('')
  const [availableDays, setAvailableDays] = useState<{label: string, value: string}[]>([])
  const [selectedDay, setSelectedDay] = useState('')
  const [availableTimes, setAvailableTimes] = useState<{label: string, value: string, disabled?: boolean}[]>([])
  const [selectedTime, setSelectedTime] = useState('')
  const [isCreatingEvent, setIsCreatingEvent] = useState(false)

  // Step management state
  const [steps, setSteps] = useState<{_id: string, step: string, checkCompletado: boolean}[]>([])
  const [loadingSteps, setLoadingSteps] = useState(false)
  const [updatingSteps, setUpdatingSteps] = useState<{[key: string]: boolean}>({})

  // Modal de confirmación + motivo obligatorio para override de step.
  // Cualquier cambio (marcar completo / quitar override) registra entry en
  // STEP_OVERRIDES.notaoverrideHistory con motivo + actor + accion + before/after.
  const [overrideModal, setOverrideModal] = useState<{
    step: string
    willEnable: boolean    // true = marcar completado | false = quitar override (soft-delete)
    motivo: string
    confirm: boolean
    saving: boolean
  } | null>(null)

  // Cargar todos los advisors de una sola vez (tabla pequeña)
  useEffect(() => {
    const loadAdvisorNames = async () => {
      try {
        const response = await fetch('/api/postgres/guias')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.advisors) {
            const map: {[key: string]: string} = {}
            for (const a of data.advisors) {
              const name = a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim()
              if (a._id) map[a._id] = name || 'Sin nombre'
              if (a.email) map[a.email] = name || 'Sin nombre'
            }
            setAdvisorNames(map)
          }
        }
      } catch (error) {
        console.error('Error loading advisors:', error)
      }
    }

    loadAdvisorNames()
  }, [])

  // Sincronizar con props cuando cambian
  useEffect(() => {
    setClasses(initialClasses)
  }, [initialClasses])

  // Cargar steps del nivel cuando se monta el componente
  useEffect(() => {
    if (student.nivel && student._id) {
      loadLevelSteps()
    }
  }, [student.nivel, student._id])

  // Función para recargar datos frescos
  const refreshStudentData = async () => {
    try {
      console.log('🔄 Recargando datos del estudiante...')
      const response = await fetch(`/api/postgres/students/${student._id}/academic?_t=${Date.now()}`)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data?.classes) {
          console.log('✅ Datos frescos recibidos:', data.data.classes.length, 'clases')
          console.log('📅 Fechas de eventos:', data.data.classes.map((c: any) => ({
            fecha: c.fechaEvento,
            nivel: c.nivel,
            step: c.step
          })))
          setClasses(data.data.classes)
        }
      }
    } catch (error) {
      console.error('❌ Error recargando datos:', error)
    }
  }

  // Step management functions
  const loadLevelSteps = async () => {
    setLoadingSteps(true)
    try {
      console.log('📊 Loading level steps for:', { nivel: student.nivel, studentId: student._id })

      const response = await fetch(`/api/postgres/niveles/${encodeURIComponent(student.nivel)}/steps?studentId=${encodeURIComponent(student.numeroId || student._id)}`)

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.steps) {
          console.log('✅ Level steps loaded:', data.steps)
          // Map endpoint shape to component shape
          const mapped = data.steps.map((s: any) => ({
            _id: s.step,
            step: s.step,
            checkCompletado: s.override?.completado === true || (s.totalClases || 0) >= 5,
          }))
          setSteps(mapped)
        } else {
          console.error('❌ Error loading steps:', data.error)
          setSteps([])
        }
      } else {
        console.error('❌ HTTP error loading steps:', response.status)
        setSteps([])
      }
    } catch (error) {
      console.error('❌ Error loading level steps:', error)
      setSteps([])
    } finally {
      setLoadingSteps(false)
    }
  }

  // El toggle ya no escribe directamente — abre el modal de confirmación con motivo.
  // El cambio real se ejecuta desde confirmOverrideChange tras motivo + checkbox.
  const handleStepToggle = (stepData: {_id: string, step: string, checkCompletado: boolean}) => {
    setOverrideModal({
      step: stepData.step,
      willEnable: !stepData.checkCompletado,
      motivo: '',
      confirm: false,
      saving: false,
    })
  }

  const confirmOverrideChange = async () => {
    if (!overrideModal) return
    const { step, willEnable, motivo, confirm } = overrideModal
    if (!confirm || !motivo.trim()) return

    setOverrideModal({ ...overrideModal, saving: true })
    setUpdatingSteps(prev => ({ ...prev, [step]: true }))
    try {
      // POST único: completado=true (marcar) o completado=null (quitar = soft-delete).
      // Motivo obligatorio se valida también server-side; actor sale de la sesión.
      const response = await fetch(`/api/postgres/students/${student.numeroId}/step-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step,
          completado: willEnable ? true : null,
          motivo: motivo.trim(),
          nivel: student.nivel,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}`)
      }

      setSteps(prevSteps =>
        prevSteps.map(s => s.step === step ? { ...s, checkCompletado: willEnable } : s)
      )
      setOverrideModal(null)
    } catch (error: any) {
      console.error('❌ Error en override:', error)
      alert(`Error al cambiar override: ${error?.message || 'Error desconocido'}`)
      setOverrideModal(om => om ? { ...om, saving: false } : null)
    } finally {
      setUpdatingSteps(prev => ({ ...prev, [step]: false }))
    }
  }

  // Nueva Clase functions
  const handleEventTypeSelection = (eventType: 'SESSION' | 'CLUB') => {
    setSelectedEventType(eventType)
    setSelectedDay('')
    setSelectedTime('')
    setAvailableTimes([])
    loadAvailableDays()
  }

  const loadAvailableDays = () => {
    // Generate next 5 days (including today)
    const today = new Date()
    const days = []

    for (let i = 0; i < 5; i++) {
      const date = new Date()
      date.setDate(today.getDate() + i)

      const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
      const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

      const dayName = dayNames[date.getDay()]
      const dayNum = date.getDate()
      const month = monthNames[date.getMonth()]

      // Usar métodos locales para obtener YYYY-MM-DD en la zona horaria del usuario
      // NO usar toISOString() porque convierte a UTC y puede cambiar el día
      const year = date.getFullYear()
      const monthNum = String(date.getMonth() + 1).padStart(2, '0')
      const dayStr = String(date.getDate()).padStart(2, '0')
      const localDateStr = `${year}-${monthNum}-${dayStr}`

      days.push({
        label: `${dayName}, ${dayNum} ${month}`,
        value: localDateStr
      })
    }

    setAvailableDays(days)
  }

  const loadAvailableTimes = async (selectedDay: string) => {
    if (!selectedEventType || !student.nivel) {
      console.warn('Missing eventType or student level')
      return
    }

    try {
      console.log('🔍 Loading available times for:', { selectedDay, eventType: selectedEventType, nivel: student.nivel })

      // Wix almacena las fechas de eventos en UTC
      // Los eventos se crean con una hora específica (ej: 7:00 AM, 2:00 PM, etc.)
      //
      // El selectedDay viene en formato YYYY-MM-DD (fecha local del usuario)
      // Para buscar eventos de ese día, usamos la zona horaria del navegador del usuario
      //
      // Obtenemos el offset de la zona horaria local en minutos
      const [year, month, day] = selectedDay.split('-').map(Number)

      // Crear fecha de inicio: medianoche del día seleccionado en hora LOCAL
      const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0)
      // Crear fecha de fin: 23:59:59 del día seleccionado en hora LOCAL
      const endLocal = new Date(year, month - 1, day, 23, 59, 59, 999)

      const startOfDay = startLocal.toISOString()
      const endOfDay = endLocal.toISOString()

      console.log('📅 Buscando eventos para:', {
        selectedDay,
        startOfDay,
        endOfDay,
        timezoneOffset: new Date().getTimezoneOffset(),
        explicacion: `Rango que cubre ${selectedDay} en hora local del usuario`
      })

      const response = await fetch(
        `/api/postgres/events/filtered?nivel=${encodeURIComponent(student.nivel)}&tipoEvento=${selectedEventType}&fechaInicio=${encodeURIComponent(startOfDay)}&fechaFin=${encodeURIComponent(endOfDay)}`
      )

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.events) {
          console.log('✅ Available times received:', data.events.length, 'eventos')
          console.log('📅 Fechas de eventos recibidos:', data.events.map((e: any) => ({
            dia: e.dia,
            diaLocal: new Date(e.dia).toString(),
            titulo: e.tituloONivel
          })))

          // Cargar cantidad de inscritos para todos los eventos
          const eventIds = data.events.map((evento: any) => evento._id)
          let inscritosPorEvento: { [key: string]: number } = {}

          if (eventIds.length > 0) {
            console.log('🔢 Cargando inscritos para', eventIds.length, 'eventos')
            try {
              const inscritosResponse = await fetch('/api/postgres/events/batch-counts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventIds })
              })

              if (inscritosResponse.ok) {
                const inscritosData = await inscritosResponse.json()
                if (inscritosData.success && inscritosData.inscritosCounts) {
                  inscritosPorEvento = inscritosData.inscritosCounts
                  console.log('✅ Inscritos cargados:', inscritosPorEvento)
                  console.log('📊 Detalle de inscritos por evento:')
                  Object.entries(inscritosPorEvento).forEach(([eventId, count]) => {
                    console.log(`  - ${eventId}: ${count} inscritos`)
                  })
                }
              }
            } catch (inscritosError) {
              console.error('⚠️ Error cargando inscritos:', inscritosError)
              // Continuar sin los inscritos
            }
          }

          // Cargar nombres de advisors para estos eventos
          // Use already-loaded advisor names map
          const eventAdvisorNames = advisorNames

          // Roles que no pueden agendar en eventos con cupo lleno
          const rolesRestringidos = [Role.SERVICIO_ASIST, Role.RECAUDOS_ASIST]
          const esRolRestringido = userRole && rolesRestringidos.includes(userRole as Role)

          // IDs de eventos en los que el estudiante ya está inscrito (no cancelados)
          const enrolledEventIds = new Set(
            classes
              .filter((c: any) => !c.cancelo)
              .map((c: any) => c.eventoId)
              .filter(Boolean)
          )
          const timeOptions = data.events
            .map((evento: any) => {
            const yaInscrito = enrolledEventIds.has(evento._id)
            const eventDate = new Date(evento.dia)
            const hour = eventDate.toLocaleTimeString('es', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true
            })

            // Obtener cantidad de inscritos para este evento
            const inscritos = inscritosPorEvento[evento._id] || 0
            const limiteUsuarios = evento.limiteUsuarios || 0
            const advisorName = eventAdvisorNames[evento.advisor] || 'Sin Advisor'
            const eventIdShort = evento._id.substring(0, 8)

            // Verificar si el evento tiene cupo lleno
            const cupoLleno = limiteUsuarios > 0 && inscritos >= limiteUsuarios
            // Deshabilitar si ya inscrito, cupo lleno para rol restringido, o ya inscrito
            const isDisabled = yaInscrito || (esRolRestringido && cupoLleno)

            const baseLabel = cupoLleno
              ? `${hour} - ${evento.tituloONivel} • 👥 ${inscritos}/${limiteUsuarios} [LLENO] • ${advisorName}`
              : `${hour} - ${evento.tituloONivel} • 👥 ${inscritos}/${limiteUsuarios} • ${advisorName} • ID: ${eventIdShort}`

            return {
              label: yaInscrito ? `${baseLabel} • ✓ Ya inscrito` : baseLabel,
              value: evento._id,
              disabled: isDisabled
            }
          })

          setAvailableTimes(timeOptions)
        }
      } else {
        console.error('Error fetching calendar events:', response.status)
        setAvailableTimes([])
      }
    } catch (error) {
      console.error('Error loading available times:', error)
      setAvailableTimes([])
    }
  }

  const handleDayChange = (day: string) => {
    setSelectedDay(day)
    setSelectedTime('')
    setAvailableTimes([])
    if (day) {
      loadAvailableTimes(day)
    }
  }

  const handleSaveNewEvent = async () => {
    console.log('🔍 handleSaveNewEvent called - selectedTime:', selectedTime)

    if (blockSchedulingByInactive) {
      alert('Usuario con estado INACTIVO. Consulte el Área de Servicio.')
      return
    }

    if (!selectedTime) {
      alert('Por favor selecciona una hora para la clase')
      return
    }

    setIsCreatingEvent(true)

    try {
      console.log('💾 Creating new class event...', { selectedTime, student: student._id })

      // Get the selected event from the calendar (fetch all events for the selected day)
      if (!selectedDay) {
        throw new Error('No se ha seleccionado un día')
      }

      // Usar el mismo cálculo consistente con loadAvailableTimes
      const [year, month, day] = selectedDay.split('-').map(Number)
      const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0)
      const endLocal = new Date(year, month - 1, day, 23, 59, 59, 999)
      const startOfDay = startLocal.toISOString()
      const endOfDay = endLocal.toISOString()

      const calendarResponse = await fetch(
        `/api/postgres/events/filtered?nivel=${encodeURIComponent(student.nivel)}&tipoEvento=${selectedEventType}&fechaInicio=${encodeURIComponent(startOfDay)}&fechaFin=${encodeURIComponent(endOfDay)}`
      )

      if (!calendarResponse.ok) {
        throw new Error('Failed to fetch calendar events')
      }

      const calendarData = await calendarResponse.json()
      console.log('📋 Calendar events fetched:', calendarData.events?.length, 'eventos')
      console.log('🔍 Looking for event ID:', selectedTime)

      const selectedEvent = calendarData.events?.find((evento: any) => evento._id === selectedTime)

      if (!selectedEvent) {
        console.error('❌ Event not found. Available events:', calendarData.events?.map((e: any) => e._id))
        throw new Error('Selected event not found in calendar')
      }

      console.log('✅ Event found:', selectedEvent)

      // Prepare event data following the Wix guardarEvento logic
      console.log('🔍 Student data available:', {
        _id: student._id,
        numeroId: student.numeroId,
        usuarioId: student.usuarioId,
        peopleId: student.peopleId,
        contrato: student.contrato
      })

      // Datos del usuario que está agendando (admin/operador)
      const usuarioAgenda = session?.user ? {
        agendadoPor: (session.user as any).name || session.user.email || 'Desconocido',
        agendadoPorEmail: session.user.email || '',
        agendadoPorRol: (session.user as any).role || 'N/A',
        fechaAgendamiento: new Date().toISOString()
      } : {}

      console.log('📅 Enrolling student in event:', { eventId: selectedEvent._id, studentId: student._id })

      const response = await fetch(`/api/postgres/events/${selectedEvent._id}/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          studentIds: [student._id],
          agendadoPor: usuarioAgenda.agendadoPor || '',
          agendadoPorEmail: usuarioAgenda.agendadoPorEmail || '',
          agendadoPorRol: usuarioAgenda.agendadoPorRol || '',
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          console.log('✅ New class event created successfully')
          setShowScheduleModal(false)
          // Reset modal state
          setSelectedEventType('')
          setSelectedDay('')
          setSelectedTime('')
          setAvailableDays([])
          setAvailableTimes([])
          // Refresh student data
          await refreshStudentData()
        } else {
          throw new Error(result.error || 'Failed to create class event')
        }
      } else {
        let errorDetail = `HTTP error: ${response.status}`
        try {
          const errData = await response.json()
          errorDetail = errData.details || errData.error || errorDetail
        } catch {}
        throw new Error(errorDetail)
      }
    } catch (error) {
      console.error('❌ Error creating class event:', error)
      alert(`Error al crear la clase: ${error instanceof Error ? error.message : 'Error desconocido'}`)
      // Refresh to sync UI with actual DB state (in case the INSERT succeeded before the error)
      await refreshStudentData()
    } finally {
      setIsCreatingEvent(false)
    }
  }


  const handleClassClick = async (classItem: Class) => {
    setSelectedClass(classItem)
    setShowClassModal(true)
    console.log("Fila seleccionada en tabla:", classItem)
    console.log("ID (_id) del registro seleccionado:", classItem._id)

    // Usar el mapa de advisors ya cargado
    if (classItem.advisor && advisorNames[classItem.advisor]) {
      setAdvisorName(advisorNames[classItem.advisor])
    } else if (classItem.advisor) {
      setAdvisorName('No encontrado')
    } else {
      setAdvisorName('No asignado')
    }
  }

  const handleSaveChanges = async () => {
    if (!selectedClass) return

    try {
      console.log('💾 Guardando cambios:', selectedClass)

      const response = await fetch(`/api/postgres/academic/${selectedClass._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          asistencia: selectedClass.asistencia,
          asistio: selectedClass.asistencia,
          participacion: selectedClass.participacion,
          calificacion: selectedClass.calificacion,
          advisorAnotaciones: (selectedClass as any).advisorAnotaciones || '',
          comentarios: (selectedClass as any).comentarios || ''
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          console.log('✅ Clase actualizada exitosamente')
          setShowClassModal(false)
          // Recargar datos frescos en lugar de recargar la página
          await refreshStudentData()
        } else {
          console.error('❌ Error al actualizar:', result.error)
          alert('Error al guardar los cambios: ' + result.error)
        }
      } else {
        console.error('❌ Error HTTP:', response.status)
        alert('Error al guardar los cambios')
      }
    } catch (error) {
      console.error('❌ Error al guardar cambios:', error)
      alert('Error al guardar los cambios')
    }
  }

  const handleDeleteClass = async () => {
    if (!selectedClass) return

    const confirmDelete = confirm('¿Estás seguro de que quieres eliminar esta clase?')
    if (!confirmDelete) return

    try {
      console.log('🗑️ Eliminando clase:', selectedClass._id)

      const response = await fetch(`/api/postgres/academic/${selectedClass._id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          console.log('✅ Clase eliminada exitosamente')
          setShowClassModal(false)
          // Recargar datos frescos en lugar de recargar la página
          await refreshStudentData()
        } else {
          console.error('❌ Error al eliminar:', result.error)
          alert('Error al eliminar la clase: ' + result.error)
        }
      } else {
        console.error('❌ Error HTTP:', response.status)
        alert('Error al eliminar la clase')
      }
    } catch (error) {
      console.error('❌ Error al eliminar clase:', error)
      alert('Error al eliminar la clase')
    }
  }

  // Filter classes based on filter states
  const filteredClasses = classes.filter(classItem => {
    // Date filter
    if (startDate) {
      const classDate = new Date((classItem as any).fechaEvento)
      const start = new Date(startDate)
      if (classDate < start) return false
    }

    if (endDate) {
      const classDate = new Date((classItem as any).fechaEvento)
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999) // Include the full end date
      if (classDate > end) return false
    }

    // Attendance filter
    if (attendanceFilter === 'attended' && !classItem.asistencia) return false
    if (attendanceFilter === 'not-attended' && classItem.asistencia) return false

    // Advisor filter
    if (advisorFilter && classItem.advisor !== advisorFilter) return false

    return true
  })

  // Get unique advisors for filter dropdown — resolve name from advisorNombre (server-joined) or advisorNames map
  const uniqueAdvisors = Array.from(
    new Map(
      classes
        .filter(c => c.advisor)
        .map(c => [
          c.advisor,
          (c as any).advisorNombre || advisorNames[c.advisor] || c.advisor,
        ])
    ).entries()
  ).map(([id, name]) => ({ id, name }))

  // Render functions for different views
  const renderAttendanceTable = () => (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-4">Tabla de Asistencia</h3>

      {/* Filters */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Filtros</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Date From */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Fecha desde
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Fecha hasta
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Attendance Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Estado de asistencia
            </label>
            <select
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value as 'all' | 'attended' | 'not-attended')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">Todos</option>
              <option value="attended">Asistió</option>
              <option value="not-attended">No asistió</option>
            </select>
          </div>

          {/* Advisor Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Advisor
            </label>
            <select
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Todos los advisors</option>
              {uniqueAdvisors.map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Clear Filters Button */}
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => {
              setStartDate('')
              setEndDate('')
              setAttendanceFilter('all')
              setAdvisorFilter('')
            }}
            className="text-xs text-gray-600 hover:text-gray-800 underline"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      <div className="table-container max-h-[500px] overflow-y-auto">
        <table className="table">
          <thead className="table-header sticky top-0 z-10 bg-gray-50">
            <tr>
              <th className="table-header-cell" style={{width: '150px'}}>Fecha</th>
              <th className="table-header-cell" style={{width: '100px'}}>Tipo</th>
              <th className="table-header-cell" style={{width: '120px'}}>Advisor</th>
              <th className="table-header-cell" style={{width: '80px'}}>Nivel</th>
              <th className="table-header-cell" style={{width: '80px'}}>Step</th>
              <th className="table-header-cell" style={{width: '100px'}}>Zoom</th>
              <th className="table-header-cell" style={{width: '80px'}}>Asistió</th>
              <th className="table-header-cell" style={{width: '80px'}}>Participó</th>
              <th className="table-header-cell" style={{width: '80px'}}>Canceló</th>
              <th className="table-header-cell" style={{width: '80px'}}>No Aprobó</th>
            </tr>
          </thead>
          <tbody className="table-body">
            {filteredClasses.length > 0 ? (
              filteredClasses.map((classItem) => (
                <tr
                  key={classItem._id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleClassClick(classItem)}
                >
                  <td className="table-cell">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime((classItem as any).fechaEvento)}
                    </div>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${getTypeBadgeClass((classItem as any).tipoEvento)}`}>
                      {(classItem as any).tipoEvento}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">
                      {classItem.advisor === 'COMPLEMENTARIA' ? (
                        <span className="text-gray-500">PLATAFORMA</span>
                      ) : classItem.advisor ? (
                        <Link
                          href={`/advisor/${classItem.advisor}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(classItem as any).advisorNombre || advisorNames[classItem.advisor] || classItem.advisor || 'Sin advisor'}
                        </Link>
                      ) : (
                        'No asignado'
                      )}
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">{classItem.nivel}</div>
                  </td>
                  <td className="table-cell">
                    <div className="text-sm text-gray-900">
                      {(classItem as any).tipo === 'CLUB' && (classItem as any).nombreEvento
                        ? (classItem as any).nombreEvento
                        : classItem.step}
                    </div>
                  </td>
                  <td className="table-cell">
                    {(classItem as any).linkZoom ? (
                      <a
                        href={(classItem as any).linkZoom}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗 Zoom
                      </a>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${classItem.asistencia ? 'badge-success' : 'badge-danger'}`}>
                      {classItem.asistencia ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${classItem.participacion ? 'badge-success' : 'badge-warning'}`}>
                      {classItem.participacion ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    {classItem.cancelo ? (
                      <span className="badge badge-danger">Sí</span>
                    ) : (
                      <span className="text-gray-400 text-xl">-</span>
                    )}
                  </td>
                  <td className="table-cell text-center">
                    {classItem.noAprobo ? (
                      <span className="text-red-500 text-xl">✗</span>
                    ) : (
                      <span className="text-gray-400 text-xl">-</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="table-cell text-center py-8">
                  <div className="text-gray-500">
                    {classes.length === 0 ? (
                      <>
                        <p>No hay clases registradas</p>
                        <p className="text-sm mt-1">Las clases aparecerán aquí una vez que se programen</p>
                      </>
                    ) : (
                      <>
                        <p>No hay clases que coincidan con los filtros</p>
                        <p className="text-sm mt-1">Prueba ajustando los filtros para ver más resultados</p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )

  const renderScheduleSection = () => (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">📅 Agendar Nueva Clase</h3>
        <button
          onClick={() => setShowScheduleModal(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <PlusIcon className="h-4 w-4" />
          <span>Nueva Clase</span>
        </button>
      </div>
      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-sm text-gray-600">
          Haz clic en &ldquo;Nueva Clase&rdquo; para programar una sesión para {student.primerNombre}
        </p>
      </div>
    </div>
  )

  const renderStepsSection = () => (
    <div>
      <h3 className="text-lg font-medium text-gray-900 mb-4">📊 Gestión de Steps</h3>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="mb-4">
          <h4 className="text-md font-medium text-gray-800">Nivel: {student.nivel}</h4>
          <p className="text-sm text-gray-600">Step actual: {student.step}</p>
        </div>

        {loadingSteps ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center space-x-2">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-gray-500">Cargando steps...</span>
            </div>
          </div>
        ) : steps.length > 0 ? (
          <div className="space-y-3">
            {steps.map((step) => (
              <div
                key={step._id}
                className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 shadow-sm"
              >
                <div className="flex items-center space-x-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{step.step}</span>
                    {step.checkCompletado && (
                      <span className="ml-2 text-xs text-green-600 font-medium">✓ Completado</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleStepToggle(step)}
                  disabled={updatingSteps[step._id]}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    step.checkCompletado
                      ? 'bg-primary-600'
                      : 'bg-gray-200'
                  }`}
                >
                  <span className="sr-only">Toggle step completion</span>
                  {updatingSteps[step._id] ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  ) : (
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        step.checkCompletado ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  )}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">No se encontraron steps para este nivel</p>
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500">
          Cada cambio en un override (marcar como completado o quitarlo) requiere un <strong>motivo</strong> y queda registrado en el historial auditable del estudiante.
        </div>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (view) {
      case 'attendance':
        return renderAttendanceTable()
      case 'schedule':
        return renderScheduleSection()
      case 'steps':
        return renderStepsSection()
      default:
        return renderAttendanceTable()
    }
  }

  return (
    <div>
      {/* Content based on selected view */}
      {renderContent()}

      {/* Modals remain the same */}
      {/* Class Details Modal */}
      {showClassModal && selectedClass && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity backdrop-blur-sm"
              onClick={() => setShowClassModal(false)}
            ></div>

            {/* Modal */}
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-5xl sm:w-full border border-gray-200">
              {/* Header */}
              <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                        <span className="text-white text-lg">📝</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white">Detalles de la Clase</h3>
                      <p className="text-primary-100 text-sm">
                        {getTypeBadgeText((selectedClass as any).tipoEvento)} • {selectedClass.nivel} • {selectedClass.step}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowClassModal(false)}
                    className="rounded-lg bg-white bg-opacity-20 p-2 text-white hover:bg-opacity-30 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 transition-all duration-200"
                  >
                    <span className="sr-only">Cerrar</span>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Info Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  {/* Date Card */}
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-blue-600">📅</span>
                      <span className="text-xs font-medium text-blue-700 uppercase tracking-wide">Fecha</span>
                    </div>
                    <p className="text-sm font-semibold text-blue-900">
                      {formatDateTime((selectedClass as any).fechaEvento)}
                    </p>
                  </div>

                  {/* Level Card */}
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-purple-600">📚</span>
                      <span className="text-xs font-medium text-purple-700 uppercase tracking-wide">Nivel</span>
                    </div>
                    <p className="text-sm font-semibold text-purple-900">
                      {selectedClass.nivel || "N/A"}
                    </p>
                  </div>

                  {/* Step Card */}
                  <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-green-600">🎯</span>
                      <span className="text-xs font-medium text-green-700 uppercase tracking-wide">Step</span>
                    </div>
                    <p className="text-sm font-semibold text-green-900">
                      {selectedClass.step || "N/A"}
                    </p>
                  </div>

                  {/* Advisor Card */}
                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-xl border border-orange-200">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-orange-600">👨‍🏫</span>
                      <span className="text-xs font-medium text-orange-700 uppercase tracking-wide">Advisor</span>
                    </div>
                    <p className="text-sm font-semibold text-orange-900">
                      {advisorName}
                    </p>
                  </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column - Attendance & Participation */}
                  {canEvaluate && (
                    <div className="space-y-6">
                      <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
                          <span>📊</span>
                          <span>Evaluación</span>
                        </h4>

                      <div className="space-y-4">
                        {/* Attendance Toggle */}
                        <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                          <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${selectedClass.asistencia ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">Asistencia</p>
                              <p className="text-xs text-gray-500">Marca si el estudiante asistió</p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedClass.asistencia || false}
                              onChange={(e) => {
                                if (selectedClass) {
                                  setSelectedClass({
                                    ...selectedClass,
                                    asistencia: e.target.checked
                                  })
                                }
                              }}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                          </label>
                        </div>

                        {/* Participation Toggle */}
                        <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                          <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${selectedClass.participacion ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">Participación</p>
                              <p className="text-xs text-gray-500">Marca si participó activamente</p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedClass.participacion || false}
                              onChange={(e) => {
                                if (selectedClass) {
                                  setSelectedClass({
                                    ...selectedClass,
                                    participacion: e.target.checked
                                  })
                                }
                              }}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                          </label>
                        </div>

                        {/* Grade Input */}
                        <div className="p-4 bg-white rounded-lg border border-gray-200">
                          <label className="block text-sm font-medium text-gray-900 mb-2">
                            Calificación (0-10)
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="10"
                              value={selectedClass.calificacion || 0}
                              onChange={(e) => {
                                if (selectedClass) {
                                  setSelectedClass({
                                    ...selectedClass,
                                    calificacion: parseInt(e.target.value) || 0
                                  })
                                }
                              }}
                              className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-lg font-semibold text-center"
                            />
                            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                              <span className="text-gray-500 text-sm">/10</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Right Column - Comments */}
                  <div className="space-y-6">
                    {/* Advisor Notes */}
                    {canAddAdvisorNotes && (
                      <div className="bg-amber-50 rounded-xl p-6 border border-amber-200">
                      <h4 className="text-lg font-semibold text-amber-900 mb-4 flex items-center space-x-2">
                        <span>📝</span>
                        <span>Anotaciones del Advisor</span>
                        {!canEditComments && (
                          <span className="ml-2 text-xs font-normal text-amber-600 bg-amber-100 px-2 py-1 rounded">
                            Solo lectura
                          </span>
                        )}
                      </h4>
                      <div className="relative">
                        <textarea
                          rows={4}
                          value={(selectedClass as any).advisorAnotaciones || ''}
                          onChange={(e) => {
                            if (selectedClass && canEditComments) {
                              setSelectedClass({
                                ...selectedClass,
                                advisorAnotaciones: e.target.value
                              } as any)
                            }
                          }}
                          readOnly={!canEditComments}
                          className={`block w-full rounded-lg border-amber-300 shadow-sm text-sm resize-none ${
                            canEditComments
                              ? 'bg-white focus:border-amber-500 focus:ring-amber-500'
                              : 'bg-amber-50 cursor-not-allowed'
                          }`}
                          placeholder={canEditComments ? "Escribir anotaciones internas que solo verán los advisors..." : ""}
                        />
                        <div className="absolute bottom-2 right-2 text-xs text-amber-600">
                          Solo para advisors
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Student Comments */}
                    {canAddStudentComments && (
                      <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                      <h4 className="text-lg font-semibold text-blue-900 mb-4 flex items-center space-x-2">
                        <span>💬</span>
                        <span>Comentarios para el Estudiante</span>
                        {!canEditComments && (
                          <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-100 px-2 py-1 rounded">
                            Solo lectura
                          </span>
                        )}
                      </h4>
                      <div className="relative">
                        <textarea
                          rows={4}
                          value={selectedClass.comentarios || ''}
                          onChange={(e) => {
                            if (selectedClass && canEditComments) {
                              setSelectedClass({
                                ...selectedClass,
                                comentarios: e.target.value
                              })
                            }
                          }}
                          readOnly={!canEditComments}
                          className={`block w-full rounded-lg border-blue-300 shadow-sm text-sm resize-none ${
                            canEditComments
                              ? 'bg-white focus:border-blue-500 focus:ring-blue-500'
                              : 'bg-blue-50 cursor-not-allowed'
                          }`}
                          placeholder={canEditComments ? "Escribir comentarios que verá el estudiante en su perfil..." : ""}
                        />
                        <div className="absolute bottom-2 right-2 text-xs text-blue-600">
                          Visible para el estudiante
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-t border-gray-200">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  {/* Left side - Delete button */}
                  {canDeleteEvent && (
                    <button
                      onClick={handleDeleteClass}
                      className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-50 hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-sm"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                      </svg>
                      Eliminar Evento
                    </button>
                  )}

                  {/* Right side - Save and Cancel buttons */}
                  <div className="flex gap-3 ml-auto">
                    <button
                      onClick={() => setShowClassModal(false)}
                      className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-sm"
                    >
                      Cancelar
                    </button>

                    {(canEvaluate || ((canAddAdvisorNotes || canAddStudentComments) && canEditComments)) && (
                      <button
                        onClick={handleSaveChanges}
                        className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-transparent bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-lg transform hover:scale-105"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        Guardar Cambios
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Nueva Clase Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 transition-opacity backdrop-blur-sm"
              onClick={() => setShowScheduleModal(false)}
            ></div>

            {/* Modal */}
            <div className="inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full border border-gray-200">
              {/* Header */}
              <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                        <span className="text-white text-lg">📅</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white">Agendar Nueva Clase</h3>
                      <p className="text-primary-100 text-sm">
                        Para {student.primerNombre} {student.primerApellido}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowScheduleModal(false)}
                    className="rounded-lg bg-white bg-opacity-20 p-2 text-white hover:bg-opacity-30 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 transition-all duration-200"
                  >
                    <span className="sr-only">Cerrar</span>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {isStudentInactive && (
                  <div
                    className={`mb-6 rounded-lg border-l-4 p-4 ${
                      canBypassInactive
                        ? 'border-amber-500 bg-amber-50 text-amber-900'
                        : 'border-red-500 bg-red-50 text-red-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl leading-none">⚠️</span>
                      <div className="text-sm">
                        <p className="font-semibold">Usuario con estado INACTIVO</p>
                        <p className="mt-1">
                          {canBypassInactive
                            ? 'Este estudiante está marcado como inactivo en ACADEMICA. Como administrador puedes continuar, pero verifica que sea correcto agendarle clases.'
                            : 'No se puede agendar clases para este estudiante porque su registro académico está inactivo. Consulte el Área de Servicio.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-6">
                  {/* Step 1: Event Type Selection */}
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 mb-4">1. Selecciona el tipo de evento</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => handleEventTypeSelection('SESSION')}
                        className={`relative px-4 py-2.5 rounded-lg border transition-all text-sm font-medium ${
                          selectedEventType === 'SESSION'
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-center">
                          <div className="font-medium">Sesión</div>
                        </div>
                        {selectedEventType === 'SESSION' && (
                          <div className="absolute top-1.5 right-1.5">
                            <div className="w-3 h-3 bg-primary-500 rounded-full flex items-center justify-center">
                              <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path>
                              </svg>
                            </div>
                          </div>
                        )}
                      </button>

                      <button
                        onClick={() => handleEventTypeSelection('CLUB')}
                        className={`relative px-4 py-2.5 rounded-lg border transition-all text-sm font-medium ${
                          selectedEventType === 'CLUB'
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-center">
                          <div className="font-medium">Club</div>
                        </div>
                        {selectedEventType === 'CLUB' && (
                          <div className="absolute top-1.5 right-1.5">
                            <div className="w-3 h-3 bg-primary-500 rounded-full flex items-center justify-center">
                              <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path>
                              </svg>
                            </div>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Day Selection */}
                  {selectedEventType && (
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 mb-4">2. Selecciona el día</h4>
                      <div className="relative">
                        <select
                          value={selectedDay}
                          onChange={(e) => handleDayChange(e.target.value)}
                          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-base"
                        >
                          <option value="">Selecciona un día...</option>
                          {availableDays.map((day) => (
                            <option key={day.value} value={day.value}>
                              {day.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Time Selection */}
                  {selectedDay && (
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 mb-4">3. Selecciona la hora</h4>
                      <div className="relative">
                        <select
                          value={selectedTime}
                          onChange={(e) => setSelectedTime(e.target.value)}
                          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-base"
                          disabled={availableTimes.length === 0}
                        >
                          <option value="">
                            {availableTimes.length === 0 ? 'Cargando horas disponibles...' : 'Selecciona una hora...'}
                          </option>
                          {availableTimes.map((time) => (
                            <option
                              key={time.value}
                              value={time.value}
                              disabled={time.disabled}
                              className={time.disabled ? 'text-gray-400 bg-gray-100' : ''}
                            >
                              {time.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {availableTimes.length === 0 && selectedDay && (
                        <p className="mt-2 text-sm text-gray-500">
                          No hay horarios disponibles para este día. Intenta con otro día.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-t border-gray-200">
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowScheduleModal(false)}
                    className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-sm"
                    disabled={isCreatingEvent}
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={handleSaveNewEvent}
                    disabled={!selectedTime || isCreatingEvent || blockSchedulingByInactive}
                    title={blockSchedulingByInactive ? 'Estudiante INACTIVO — solo SUPER_ADMIN puede agendar' : undefined}
                    className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg border border-transparent bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-all duration-200 text-sm font-medium shadow-lg transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {isCreatingEvent ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        Guardar Evento
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación + motivo para override de step (auditable) */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => !overrideModal.saving && setOverrideModal(null)} />
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900">
                {overrideModal.willEnable
                  ? `Marcar ${overrideModal.step} como COMPLETADO`
                  : `Quitar override de ${overrideModal.step}`}
              </h3>
              <p className="mt-2 text-sm text-gray-600">
                {overrideModal.willEnable
                  ? 'Este step se considerará aprobado por administración aunque no se cumplan las clases del currículo.'
                  : 'El override se quitará (soft-delete). El step volverá a calcularse desde los bookings.'} El cambio queda registrado con tu usuario, fecha y motivo en el historial auditable.
              </p>

              <label className="block mt-4 text-sm font-medium text-gray-700">Motivo (obligatorio)</label>
              <textarea
                rows={3}
                value={overrideModal.motivo}
                onChange={e => setOverrideModal(om => om ? { ...om, motivo: e.target.value } : null)}
                disabled={overrideModal.saving}
                placeholder="Describe brevemente por qué aplicas este cambio…"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />

              <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={overrideModal.confirm}
                  onChange={e => setOverrideModal(om => om ? { ...om, confirm: e.target.checked } : null)}
                  disabled={overrideModal.saving}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Confirmo este cambio
              </label>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOverrideModal(null)}
                  disabled={overrideModal.saving}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmOverrideChange}
                  disabled={!overrideModal.confirm || !overrideModal.motivo.trim() || overrideModal.saving}
                  className={`px-4 py-2 text-sm rounded-lg text-white font-medium ${
                    overrideModal.willEnable ? 'bg-primary-600 hover:bg-primary-700' : 'bg-amber-600 hover:bg-amber-700'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {overrideModal.saving ? 'Guardando…' : overrideModal.willEnable ? 'Marcar completado' : 'Quitar override'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getTypeBadgeClass(tipoEvento: string): string {
  switch (tipoEvento) {
    case 'SESSION':
      return 'badge-info'
    case 'CLUB':
      return 'badge-success'
    case 'WELCOME':
      return 'badge-warning'
    case 'COMPLEMENTARIA':
      return 'badge-info'
    default:
      return 'badge-info'
  }
}

function getTypeBadgeText(tipoEvento: string): string {
  switch (tipoEvento) {
    case 'SESSION':
      return 'Sesión'
    case 'CLUB':
      return 'Club'
    case 'WELCOME':
      return 'Bienvenida'
    case 'COMPLEMENTARIA':
      return 'Complementaria'
    default:
      return tipoEvento
  }
}