'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { isEventoCompartible, reasonNotCompartible, MAX_NIVELES_COMPARTIDOS, extractClubPrefix } from '@/lib/evento-compartido'

interface CalendarEvent {
  _id: string
  dia: Date
  evento?: 'SESSION' | 'CLUB'
  tipo?: string
  tituloONivel: string
  nombreEvento?: string
  nivel?: string
  step?: string
  advisor: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
}

interface Advisor {
  _id: string
  primerNombre: string
  primerApellido: string
  zoom?: string
}

interface Nivel {
  _id: string
  code: string
  steps: string[]
  clubs: string[]
  orden?: number | null
}

interface StepOption {
  value: string
  label: string
}

interface ClubOption {
  value: string
  label: string
}

interface EventModalProps {
  isOpen: boolean
  editingEvent: CalendarEvent | null
  advisors: Advisor[]
  selectedDate?: Date | null
  onSave: (eventData: any) => void
  onClose: () => void
}

export default function EventModal({
  isOpen,
  editingEvent,
  advisors,
  selectedDate,
  onSave,
  onClose
}: EventModalProps) {
  const [formData, setFormData] = useState({
    fecha: '',
    hora: '',
    evento: 'SESSION' as 'SESSION' | 'CLUB',
    tituloONivel: '',
    nombreEvento: '',
    advisor: '',
    observaciones: '',
    limiteUsuarios: 20,
    linkZoom: '',
    clubStep: ''
  })

  const [niveles, setNiveles] = useState<Nivel[]>([])
  const [codigosNivel, setCodigosNivel] = useState<string[]>([])
  const [stepOptions, setStepOptions] = useState<StepOption[]>([])
  const [clubOptions, setClubOptions] = useState<ClubOption[]>([])
  const [showClubStep, setShowClubStep] = useState(false)
  const [showNombreClub, setShowNombreClub] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [savedNombreEvento, setSavedNombreEvento] = useState('')

  // Evento compartido entre niveles (solo modo CREAR — al editar no se cambia
  // la composición del grupo, sólo los campos comunes que se propagan).
  // Cada entrada del array es un nivel adicional con su propio step.
  const [compartidoActivo, setCompartidoActivo] = useState(false)
  const [compartidoCon, setCompartidoCon] = useState<Array<{ nivel: string; step: string; options: StepOption[] }>>([])

  // Cargar códigos únicos al montar el componente
  useEffect(() => {
    if (isOpen) {
      loadCodigosNivel()
    }
  }, [isOpen])

  // Ejecutar cargarNombreStep cuando cambia tipo de evento (si ya hay nivel)
  useEffect(() => {
    if (formData.tituloONivel) {
      cargarNombreStep()
    }
  }, [formData.evento])

  // Ejecutar cargarNombreStep cuando cambia nivel (si ya hay tipo)
  useEffect(() => {
    if (formData.evento) {
      cargarNombreStep()
    }
  }, [formData.tituloONivel])

  // Manejar cambio de tipo de evento y nivel
  useEffect(() => {
    if (formData.evento && formData.tituloONivel) {
      // Cargar opciones cuando hay tipo de evento y nivel seleccionados
      cargarNombreStep()
    } else {
      // Limpiar todo si falta información
      setShowClubStep(false)
      setShowNombreClub(false)
      setStepOptions([])
      setClubOptions([])
    }
  }, [formData.evento, formData.tituloONivel])

  // Manejar cambio de step cuando es CLUB
  useEffect(() => {
    if (formData.evento === 'CLUB' && formData.clubStep && formData.tituloONivel) {
      loadClubsPorNivelYStep(formData.tituloONivel, formData.clubStep)
    }
  }, [formData.clubStep, formData.tituloONivel, formData.evento])

  // Generar opciones de horas (6:00 AM - 10:00 PM)
  const generateHourOptions = () => {
    const hours = []
    for (let i = 6; i <= 22; i++) {
      const time24 = `${i.toString().padStart(2, '0')}:00`
      const time12 = i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`
      hours.push({ value: time24, label: time12 })
    }
    return hours
  }

  const hourOptions = generateHourOptions()

  // Inicializar formulario cuando hay un evento para editar o cuando se abre el modal
  useEffect(() => {
    if (editingEvent) {
      const eventDate = new Date(editingEvent.dia)

      // Extraer advisor ID si viene como objeto
      let advisorId = editingEvent.advisor
      if (typeof editingEvent.advisor === 'object' && editingEvent.advisor !== null) {
        advisorId = (editingEvent.advisor as any)._id
      }

      // Guardar nombreEvento antes de cargar opciones
      const nombreEventoValue = editingEvent.nombreEvento || ''
      setSavedNombreEvento(nombreEventoValue)
      setIsEditMode(true)

      // Resolve nivel: prefer separate `nivel` field, fallback to parsing tituloONivel
      const resolvedNivel = editingEvent.nivel
        || editingEvent.tituloONivel?.split(' - ')[0]?.trim()
        || editingEvent.tituloONivel

      setFormData({
        fecha: format(eventDate, 'yyyy-MM-dd'),
        hora: format(eventDate, 'HH:mm'),
        evento: (editingEvent.evento || editingEvent.tipo || 'SESSION') as 'SESSION' | 'CLUB',
        tituloONivel: resolvedNivel,
        nombreEvento: nombreEventoValue,
        advisor: advisorId,
        observaciones: editingEvent.observaciones || '',
        limiteUsuarios: editingEvent.limiteUsuarios,
        linkZoom: editingEvent.linkZoom || '',
        clubStep: ''
      })

      const eventType = editingEvent.evento || editingEvent.tipo
      // Cargar opciones de step/club después de un pequeño delay para asegurar que niveles esté cargado
      setTimeout(() => {
        if (niveles.length === 0) {
          // Si niveles no está cargado, cargarlos primero
          loadCodigosNivel().then((loadedNiveles) => {
            // Luego cargar opciones de step/club con los niveles recién cargados
            if (eventType === 'SESSION' || eventType === 'CLUB') {
              cargarNombreStepForEdit(resolvedNivel, eventType, nombreEventoValue, loadedNiveles)
            }
          })
        } else {
          // Si niveles ya está cargado, cargar directamente
          if (eventType === 'SESSION' || eventType === 'CLUB') {
            cargarNombreStepForEdit(resolvedNivel, eventType, nombreEventoValue, niveles)
          }
        }
      }, 100)
    } else {
      // Reset form for new event
      setIsEditMode(false)
      setSavedNombreEvento('')
      const defaultDate = selectedDate || new Date()
      setFormData({
        fecha: format(defaultDate, 'yyyy-MM-dd'),
        hora: '18:00', // Default to 6:00 PM
        evento: 'SESSION',
        tituloONivel: '',
        nombreEvento: '',
        advisor: '',
        observaciones: '',
        limiteUsuarios: 20,
        linkZoom: '',
        clubStep: ''
      })
    }
  }, [editingEvent, selectedDate, isOpen])

  const loadCodigosNivel = async () => {
    try {
      const response = await fetch('/api/postgres/niveles', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        const data = await response.json()
        // API puede devolver "niveles" o "data" dependiendo del endpoint
        const nivelesArray = data.niveles || data.data || []
        if (data.success && nivelesArray.length > 0) {
          setNiveles(nivelesArray)
          // Extraer códigos únicos (eliminar duplicados)
          const codigos = [...new Set(nivelesArray.map((nivel: any) => nivel.code))] as string[]
          setCodigosNivel(codigos)
          console.log('✅ Niveles loaded:', nivelesArray.length, 'códigos únicos:', codigos.length)
          return nivelesArray
        }
      }
      return []
    } catch (error) {
      console.error('Error loading códigos nivel:', error)
      return []
    }
  }

  const loadStepsPorNivel = async (codigoNivel: string) => {
    try {
      // Buscar el nivel por código en el nuevo formato
      const nivelEncontrado = niveles.find(nivel => nivel.code === codigoNivel)
      if (nivelEncontrado && nivelEncontrado.steps) {
        const steps = nivelEncontrado.steps.map(step => ({
          value: step,
          label: getStepLabel(step)
        }))
        setStepOptions(steps)
        console.log('✅ Steps loaded for', codigoNivel, ':', steps.length)
      }
    } catch (error) {
      console.error('Error loading steps:', error)
    }
  }

  const loadClubsPorNivelYStep = async (codigoNivel: string, step?: string) => {
    try {
      // En el nuevo formato, los clubs están a nivel de código, no de step específico
      const nivelEncontrado = niveles.find(nivel => nivel.code === codigoNivel)
      if (nivelEncontrado && nivelEncontrado.clubs) {
        const clubs = nivelEncontrado.clubs.map(club => ({
          value: club,
          label: club
        }))
        setClubOptions(clubs)
        setShowClubStep(false)
        setShowNombreClub(true)
        console.log('✅ Clubs loaded for', codigoNivel, ':', clubs.length)
      }
    } catch (error) {
      console.error('Error loading clubs:', error)
    }
  }

  const getStepLabel = (step: string): string => {
    if (!step) return "Sin Step"

    const jumps = [5, 10, 15, 20, 25, 30, 35, 40, 45]
    const stepNumber = parseInt(step.replace("Step ", ""))

    if (jumps.includes(stepNumber)) {
      return `Jump (Step ${stepNumber})`
    } else if (!isNaN(stepNumber)) {
      return `Step ${stepNumber}`
    } else {
      return step
    }
  }

  // Función especial para cargar opciones en modo edición
  const cargarNombreStepForEdit = (nivel: string, tipoEvento: string, nombreEventoToRestore: string, nivelesData: Nivel[]) => {
    console.log("🔧 cargarNombreStepForEdit - Nivel:", nivel, "Tipo:", tipoEvento, "nombreEvento:", nombreEventoToRestore)
    console.log("🔧 Niveles disponibles:", nivelesData.length)

    if (!nivel) {
      console.log("❌ No hay nivel seleccionado")
      return
    }

    // Buscar el nivel por código en el nuevo formato estructurado
    const nivelEncontrado = nivelesData.find(n => n.code === nivel)
    console.log("🔍 Nivel encontrado:", nivelEncontrado ? nivelEncontrado.code : 'NO ENCONTRADO')

    if (nivelEncontrado) {
      let opciones: { value: string, label: string }[] = []

      if (tipoEvento === "CLUB") {
        // Si el evento es CLUB, obtener los valores del array "clubs"
        const clubs = nivelEncontrado.clubs || []
        opciones = clubs.map(club => ({
          value: club,
          label: club
        }))
        console.log("✅ Opciones de clubs cargadas:", opciones.length)
        setClubOptions(opciones)
        setShowClubStep(false)
        setShowNombreClub(true)
      } else {
        // Si no es CLUB (SESSION), obtener los valores de steps
        const steps = nivelEncontrado.steps || []
        opciones = steps.map(step => ({
          value: step,
          label: getStepLabel(step)
        }))
        console.log("✅ Opciones de steps cargadas:", opciones.length)
        setStepOptions(opciones)
        setShowClubStep(false)
        setShowNombreClub(true)  // Mostrar dropdown para SESSION también
      }

      // Restaurar nombreEvento después de cargar opciones
      setTimeout(() => {
        setFormData(prev => ({
          ...prev,
          nombreEvento: nombreEventoToRestore
        }))
        console.log("✅ nombreEvento restaurado:", nombreEventoToRestore)
      }, 50)
    }
  }

  // Función que replica exactamente cargarNombreStep() de CALENDARIO.js
  // Helper sin side-effects: devuelve las opciones (step o club) de un nivel.
  // Usado por la UI de "Evento compartido" — cada nivel adicional necesita
  // su propio dropdown de step y no podemos pisar setStepOptions/setClubOptions.
  //
  // Para CLUB: si se pasa `clubPrefixFilter`, filtra las opciones para que
  // solo aparezcan las del mismo tipo de club (ej. solo KARAOKE si el base
  // es KARAOKE). Esto impide mezclar tipos en un grupo compartido.
  // ─────────────────────────────────────────────────────────────────────
  // Helpers para AUTO-SUGERENCIA del step pedagógico al agregar un nivel
  // adicional al grupo compartido.
  //
  // Regla: para grupos compartidos, el step debería avanzar +5 por cada
  // nivel consecutivo dentro de la misma etapa (BN1→BN2 = +5, BN1→BN3 = +10,
  // P1→P3 = +10, etc.). El "5" es el tamaño estándar de cada nivel del
  // programa (cada nivel tiene 5 steps).
  //
  // Ej: base = CLUB LISTENING BN1 Step 3
  //   - agregar BN2 → sugiere "LISTENING - Step 8" (3 + 5)
  //   - agregar BN3 → sugiere "LISTENING - Step 13" (3 + 10)
  //
  // Si la opción sugerida NO existe en los clubs/steps del nivel adicional
  // (datos faltantes en NIVELES), dejamos el dropdown vacío y el admin elige.
  // ─────────────────────────────────────────────────────────────────────

  /** Extrae el número del step. "Step 3" → 3, "LISTENING - Step 16" → 16, null si no matchea. */
  const extractStepNumber = (stepStr: string): number | null => {
    const m = (stepStr || '').match(/Step\s+(\d+)/i)
    return m ? parseInt(m[1], 10) : null
  }

  /** Reemplaza el número del step preservando el prefijo del club.
   *  "LISTENING - Step 3" + 8 → "LISTENING - Step 8". */
  const replaceStepNumber = (stepStr: string, newN: number): string => {
    return (stepStr || '').replace(/Step\s+\d+/i, `Step ${newN}`)
  }

  /** Calcula el offset pedagógico entre dos niveles usando NIVELES.orden.
   *  Devuelve 0 si no encuentra los niveles (no aplica auto-sugerencia). */
  const calcStepOffset = (baseNivelCode: string, adicNivelCode: string): number => {
    const ordBase = niveles.find(n => n.code === baseNivelCode)?.orden
    const ordAdic = niveles.find(n => n.code === adicNivelCode)?.orden
    if (typeof ordBase !== 'number' || typeof ordAdic !== 'number') return 0
    return 5 * (ordAdic - ordBase)
  }

  const getOptionsForNivelTipo = (
    nivelCode: string,
    tipo: 'SESSION' | 'CLUB',
    clubPrefixFilter?: string | null,
  ): StepOption[] => {
    const niv = niveles.find(n => n.code === nivelCode)
    if (!niv) return []
    if (tipo === 'CLUB') {
      let opts = (niv.clubs || []).map(c => ({ value: c, label: c }))
      if (clubPrefixFilter) {
        opts = opts.filter(o => extractClubPrefix(o.value) === clubPrefixFilter)
      }
      return opts
    }
    return (niv.steps || []).map(s => ({ value: s, label: getStepLabel(s) }))
  }

  // Compatibilidad del evento actual para activar el toggle de compartido.
  // En CREAR usa formData.evento + formData.nombreEvento (que ya contiene
  // el step seleccionado del dropdown). NO se muestra en EDIT — para evitar
  // que el admin "convierta" un evento existente en compartido (eso requiere
  // crear los hermanos desde 0).
  const compartibleHabilitado = !isEditMode
    && isEventoCompartible(formData.evento, formData.nombreEvento)
  const compartibleMotivo = !isEditMode
    ? reasonNotCompartible(formData.evento, formData.nombreEvento)
    : 'Para compartir entre niveles crea un evento nuevo desde 0 — al editar uno existente sólo cambian sus campos.'

  // Si el toggle queda activo pero el step deja de ser compartible (ej. admin
  // cambió de SESSION Step 5 a Step 6), apagamos el toggle automáticamente.
  useEffect(() => {
    if (!compartibleHabilitado && compartidoActivo) {
      setCompartidoActivo(false)
      setCompartidoCon([])
    }
  }, [compartibleHabilitado, compartidoActivo])

  // Niveles disponibles para agregar al grupo: cualquiera distinto al base y
  // que no esté ya elegido por otra entrada del array.
  const nivelesUsados = new Set<string>([formData.tituloONivel, ...compartidoCon.map(c => c.nivel)])

  // Prefijo de club del evento BASE (ej. "KARAOKE" si nombreEvento = "KARAOKE - Step 16").
  // Para SESSION devuelve null. Se usa para filtrar las opciones de step de
  // los niveles adicionales: en grupos CLUB, todos deben ser del mismo tipo.
  const baseClubPrefix = formData.evento === 'CLUB'
    ? extractClubPrefix(formData.nombreEvento)
    : null

  const agregarNivelCompartido = () => {
    if (compartidoCon.length >= MAX_NIVELES_COMPARTIDOS - 1) return
    setCompartidoCon([...compartidoCon, { nivel: '', step: '', options: [] }])
  }
  const quitarNivelCompartido = (idx: number) => {
    setCompartidoCon(compartidoCon.filter((_, i) => i !== idx))
  }
  const actualizarNivelCompartido = (idx: number, nivel: string) => {
    const options = getOptionsForNivelTipo(nivel, formData.evento, baseClubPrefix)

    // Auto-sugerencia del step pedagógico equivalente.
    // baseStepRaw para CLUB es "LISTENING - Step 3", para SESSION es "Step 5".
    const baseStepRaw = formData.nombreEvento || ''
    const baseStepN = extractStepNumber(baseStepRaw)
    const baseNivelCode = formData.tituloONivel
    const offset = calcStepOffset(baseNivelCode, nivel)
    let stepSugerido = ''
    if (baseStepN != null && offset !== 0) {
      const sugeridoN = baseStepN + offset
      const sugeridoStr = replaceStepNumber(baseStepRaw, sugeridoN)
      // Solo aplicamos si la opción realmente existe en este nivel
      if (options.some(o => o.value === sugeridoStr)) {
        stepSugerido = sugeridoStr
      }
    }

    setCompartidoCon(compartidoCon.map((c, i) =>
      i === idx ? { ...c, nivel, step: stepSugerido, options } : c
    ))
  }
  const actualizarStepCompartido = (idx: number, step: string) => {
    setCompartidoCon(compartidoCon.map((c, i) =>
      i === idx ? { ...c, step } : c
    ))
  }

  // Si el admin cambia el step base (ej. de KARAOKE a LISTENING) después de
  // haber agregado niveles adicionales, las opciones de step ya cacheadas
  // pueden volverse inválidas. Las recargamos con el nuevo prefijo y
  // limpiamos el step seleccionado si ya no es válido.
  useEffect(() => {
    if (compartidoCon.length === 0) return
    setCompartidoCon(prev => prev.map(c => {
      if (!c.nivel) return c
      const newOptions = getOptionsForNivelTipo(c.nivel, formData.evento, baseClubPrefix)
      const stepStillValid = newOptions.some(o => o.value === c.step)
      return { ...c, options: newOptions, step: stepStillValid ? c.step : '' }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseClubPrefix, formData.evento])

  const cargarNombreStep = () => {
    const nivelSeleccionado = formData.tituloONivel
    const tipoEventoSeleccionado = formData.evento

    console.log("Nivel seleccionado:", nivelSeleccionado)
    console.log("Tipo de evento seleccionado:", tipoEventoSeleccionado)

    if (!nivelSeleccionado) return

    // Buscar el nivel por código en el nuevo formato estructurado
    const nivelEncontrado = niveles.find(nivel => nivel.code === nivelSeleccionado)

    if (nivelEncontrado) {
      let opciones: { value: string, label: string }[] = []

      if (tipoEventoSeleccionado === "CLUB") {
        // Si el evento es CLUB, obtener los valores del array "clubs"
        const clubs = nivelEncontrado.clubs || []
        opciones = clubs.map(club => ({
          value: club,
          label: club
        }))
        console.log("Opciones cargadas desde clubs:", opciones)
        setClubOptions(opciones)
        setShowClubStep(false)
        setShowNombreClub(true)
      } else {
        // Si no es CLUB (SESSION), obtener los valores de steps
        const steps = nivelEncontrado.steps || []
        opciones = steps.map(step => ({
          value: step,
          label: getStepLabel(step)
        }))
        console.log("Opciones cargadas desde steps:", opciones)
        setStepOptions(opciones)
        setShowClubStep(false)
        setShowNombreClub(true)  // Mostrar dropdown para SESSION también
      }

      // NO limpiar nombreEvento si estamos en modo edición
      if (!isEditMode) {
        setFormData(prev => ({
          ...prev,
          nombreEvento: ''
        }))
      }
    }
  }

  // Estado para confirmación de cambio de advisor (Ctrl Horas hook)
  const [pendingAdvisorChange, setPendingAdvisorChange] = useState<{
    eventData: any
    oldAdvisorName: string
    newAdvisorName: string
  } | null>(null)
  const [confirmReassignChecked, setConfirmReassignChecked] = useState(false)
  const [reassignMotivo, setReassignMotivo] = useState('')
  /** Modo "Restructuración" para cambio de advisor — no registra en
   *  ADVISOR_EVENT_LOG. Útil cuando es fix de planificación, no cancelación
   *  real del advisor original (mismo patrón que el modal de Cancelar Evento). */
  const [reassignSkipLog, setReassignSkipLog] = useState(false)

  /** Confirmación de cambio de nivel/step (sólo cuando 0 estudiantes inscritos).
   *  Si hay inscritos > 0, se muestra `nivelChangeBlocked` en su lugar. */
  const [pendingNivelChange, setPendingNivelChange] = useState<{
    eventData: any
    oldLabel: string
    newLabel: string
  } | null>(null)
  /** Modal bloqueante cuando el evento tiene inscritos y se intenta cambiar
   *  nivel/step. Sólo permite cerrar (Salir) — no permite proceder. */
  const [nivelChangeBlocked, setNivelChangeBlocked] = useState<{
    oldLabel: string
    newLabel: string
    inscritos: number
  } | null>(null)

  function advisorNameById(id: string): string {
    const a = advisors.find(x => x._id === id)
    if (!a) return id
    return `${a.primerNombre ?? ''} ${a.primerApellido ?? ''}`.trim() || id
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Validaciones básicas
      if (!formData.fecha || !formData.hora || !formData.tituloONivel || !formData.advisor) {
        setError('Todos los campos obligatorios deben estar completos')
        return
      }

      // Combinar fecha y hora para crear la fecha completa
      const dateTimeString = `${formData.fecha}T${formData.hora}:00`
      const eventDateTime = new Date(dateTimeString)

      // Si el toggle "Evento compartido" está activo, validamos que cada
      // entrada tenga nivel y step elegidos. La validación de compartibilidad
      // y unicidad de niveles la repite el backend como defensa en profundidad.
      let compartidoConPayload: Array<{ nivel: string; step: string }> | undefined
      if (compartidoActivo && compartidoCon.length > 0) {
        const incompletos = compartidoCon.filter(c => !c.nivel || !c.step)
        if (incompletos.length > 0) {
          setError('Completa nivel y step en cada nivel adicional del evento compartido.')
          return
        }
        compartidoConPayload = compartidoCon.map(c => ({ nivel: c.nivel, step: c.step }))
      }

      // Preparar datos para enviar
      const eventData: Record<string, any> = {
        dia: eventDateTime.toISOString(),
        evento: formData.evento,
        tituloONivel: formData.tituloONivel,
        nombreEvento: formData.nombreEvento || undefined,
        advisor: formData.advisor,
        observaciones: formData.observaciones || undefined,
        limiteUsuarios: Number(formData.limiteUsuarios),
        linkZoom: formData.linkZoom || undefined,
      }
      if (compartidoConPayload) eventData.compartidoCon = compartidoConPayload

      // Guarda integridad: si estamos editando Y cambia nivel o step (nombreEvento),
      // detectamos antes y mostramos modal apropiado:
      //   - Si el evento tiene inscritos > 0 → modal BLOQUEANTE (sólo Salir)
      //   - Si tiene 0 inscritos → modal de confirmación "BN3 - Step 11 → P1 - Step 16"
      // Esto evita corromper historiales de bookings (que apuntan al nivel/step
      // del evento). La validación se replica en el backend como defensa.
      if (editingEvent) {
        const oldNivel = (editingEvent as any).nivel || (editingEvent as any).tituloONivel || ''
        const oldStep  = (editingEvent as any).step  || (editingEvent as any).nombreEvento || ''
        const newNivel = formData.tituloONivel || ''
        const newStep  = formData.nombreEvento || ''
        const nivelChanged = oldNivel && newNivel && oldNivel !== newNivel
        const stepChanged  = oldStep && newStep && oldStep !== newStep
        if (nivelChanged || stepChanged) {
          const inscritos = Number((editingEvent as any).inscritos ?? 0)
          const oldLabel = `${oldNivel}${oldStep ? ` - ${oldStep}` : ''}`
          const newLabel = `${newNivel}${newStep ? ` - ${newStep}` : ''}`
          if (inscritos > 0) {
            setNivelChangeBlocked({ oldLabel, newLabel, inscritos })
            setLoading(false)
            return
          }
          // 0 inscritos → mostrar confirmación. Si el advisor también cambió,
          // se mostrará el modal de advisor DESPUÉS (en confirmNivelChange).
          setPendingNivelChange({ eventData, oldLabel, newLabel })
          setLoading(false)
          return
        }
      }

      // Hook Ctrl Horas: si estamos editando Y cambia el advisor, pedir confirmación
      const isAdvisorChange = !!editingEvent && (editingEvent as any).advisor && (editingEvent as any).advisor !== formData.advisor
      if (isAdvisorChange) {
        setPendingAdvisorChange({
          eventData,
          oldAdvisorName: advisorNameById((editingEvent as any).advisor),
          newAdvisorName: advisorNameById(formData.advisor),
        })
        setConfirmReassignChecked(false)
        setReassignMotivo('')
        setReassignSkipLog(false)
        return
      }

      onSave(eventData)
    } catch (error) {
      console.error('Error saving event:', error)
      setError('Error al guardar el evento')
    } finally {
      setLoading(false)
    }
  }

  function confirmAdvisorReassignment() {
    if (!pendingAdvisorChange || !confirmReassignChecked) return
    const enriched = {
      ...pendingAdvisorChange.eventData,
      _motivoCambioAdvisor: reassignMotivo.trim() || undefined,
      // Restructuración: el backend honra _skipLog=true y NO inserta
      // entrada Canceled en ADVISOR_EVENT_LOG.
      _skipLog: reassignSkipLog || undefined,
    }
    setPendingAdvisorChange(null)
    onSave(enriched)
  }

  function cancelAdvisorReassignment() {
    setPendingAdvisorChange(null)
    setConfirmReassignChecked(false)
    setReassignMotivo('')
    setReassignSkipLog(false)
    setLoading(false)
  }

  /** Confirmar cambio de nivel/step cuando NO hay estudiantes inscritos.
   *  Tras confirmar, si el advisor también cambió, se dispara el modal
   *  de cambio de advisor en cascada; si no, se guarda directamente. */
  function confirmNivelChange() {
    if (!pendingNivelChange) return
    const eventData = pendingNivelChange.eventData
    setPendingNivelChange(null)
    // Re-check advisor change y disparar su propio modal si aplica
    const isAdvisorChange = !!editingEvent && (editingEvent as any).advisor && (editingEvent as any).advisor !== formData.advisor
    if (isAdvisorChange) {
      setPendingAdvisorChange({
        eventData,
        oldAdvisorName: advisorNameById((editingEvent as any).advisor),
        newAdvisorName: advisorNameById(formData.advisor),
      })
      setConfirmReassignChecked(false)
      setReassignMotivo('')
      setReassignSkipLog(false)
      return
    }
    onSave(eventData)
  }

  function cancelNivelChange() {
    setPendingNivelChange(null)
    setLoading(false)
  }

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))

    // Manejar cambios específicos
    if (field === 'advisor' && value) {
      // Auto-llenar zoom del advisor
      const selectedAdvisor = advisors.find(advisor => advisor._id === value)
      const advisorZoom = selectedAdvisor?.zoom || ''

      console.log('📹 Advisor seleccionado:', selectedAdvisor?.primerNombre, selectedAdvisor?.primerApellido)
      console.log('📹 Zoom link encontrado:', advisorZoom)

      setFormData(prev => ({
        ...prev,
        advisor: value,
        linkZoom: advisorZoom
      }))
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose}></div>

        <div className="relative bg-gray-50 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-white rounded-t-lg mx-4 mt-4">
            <h3 className="text-lg font-medium text-gray-900">
              {editingEvent ? 'Editar Evento' : 'Crear Nuevo Evento'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white rounded-b-lg mx-4 mb-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <div className="text-red-500 text-sm">{error}</div>
                </div>
              </div>
            )}

            {/* Fecha */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fecha *
              </label>
              <input
                type="date"
                value={formData.fecha}
                onChange={(e) => handleInputChange('fecha', e.target.value)}
                className="input w-full"
                required
              />
            </div>

            {/* Hora */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Hora *
              </label>
              <select
                value={formData.hora}
                onChange={(e) => handleInputChange('hora', e.target.value)}
                className="input w-full"
                required
              >
                <option value="">Seleccionar hora</option>
                {hourOptions.map((hour) => (
                  <option key={hour.value} value={hour.value}>
                    {hour.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Tipo de Evento */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de Evento *
              </label>
              <select
                value={formData.evento}
                onChange={(e) => handleInputChange('evento', e.target.value)}
                className="input w-full"
                required
              >
                <option value="SESSION">Sesión</option>
                <option value="CLUB">Club</option>
              </select>
            </div>

            {/* Título/Nivel */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nivel *
              </label>
              <select
                value={formData.tituloONivel}
                onChange={(e) => handleInputChange('tituloONivel', e.target.value)}
                className="input w-full"
                required
              >
                <option value="">Seleccionar nivel</option>
                {codigosNivel.map((codigo) => (
                  <option key={codigo} value={codigo}>
                    {codigo}
                  </option>
                ))}
              </select>
            </div>

            {/* Club Step (solo para CLUB) */}
            {showClubStep && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Step *
                </label>
                <select
                  value={formData.clubStep}
                  onChange={(e) => handleInputChange('clubStep', e.target.value)}
                  className="input w-full"
                  required
                >
                  <option value="">Seleccionar step</option>
                  {stepOptions.map((step) => (
                    <option key={step.value} value={step.value}>
                      {step.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Nombre del Evento (dinámico según tipo) */}
            {(formData.evento === 'SESSION' || formData.evento === 'CLUB') && formData.tituloONivel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {formData.evento === 'CLUB' ? 'Club' : 'Step'} *
                </label>
                <select
                  value={formData.nombreEvento}
                  onChange={(e) => handleInputChange('nombreEvento', e.target.value)}
                  className="input w-full"
                  required
                >
                  <option value="">
                    {formData.evento === 'CLUB' ? 'Seleccionar club' : 'Seleccionar step'}
                  </option>
                  {formData.evento === 'CLUB'
                    ? clubOptions.map((club) => (
                        <option key={club.value} value={club.value}>
                          {club.label}
                        </option>
                      ))
                    : stepOptions.map((step) => (
                        <option key={step.value} value={step.value}>
                          {step.label}
                        </option>
                      ))
                  }
                </select>
              </div>
            )}


            {/* Advisor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Advisor *
              </label>
              <select
                value={formData.advisor}
                onChange={(e) => handleInputChange('advisor', e.target.value)}
                className="input w-full"
                required
              >
                <option value="">Seleccionar advisor</option>
                {advisors
                  .slice()
                  .sort((a, b) => {
                    const nameA = `${a.primerNombre} ${a.primerApellido}`.toLowerCase()
                    const nameB = `${b.primerNombre} ${b.primerApellido}`.toLowerCase()
                    return nameA.localeCompare(nameB)
                  })
                  .map((advisor) => (
                    <option key={advisor._id} value={advisor._id}>
                      {advisor.primerNombre} {advisor.primerApellido}
                    </option>
                  ))}
              </select>
            </div>

            {/* Límite de Usuarios */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Límite de Usuarios *
              </label>
              <input
                type="number"
                value={formData.limiteUsuarios}
                onChange={(e) => handleInputChange('limiteUsuarios', Number(e.target.value))}
                className="input w-full"
                min="1"
                max="100"
                required
              />
            </div>

            {/* Link Zoom */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Link de Zoom
              </label>
              <input
                type="url"
                value={formData.linkZoom}
                onChange={(e) => handleInputChange('linkZoom', e.target.value)}
                className="input w-full"
                placeholder="https://zoom.us/..."
              />
            </div>

            {/* Evento compartido entre niveles — sólo en CREAR */}
            {!isEditMode && (
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[280px]">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 select-none">
                      <input
                        type="checkbox"
                        checked={compartidoActivo}
                        onChange={e => {
                          setCompartidoActivo(e.target.checked)
                          if (!e.target.checked) setCompartidoCon([])
                        }}
                        disabled={!compartibleHabilitado}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Evento compartido entre niveles
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      {compartibleHabilitado
                        ? `Crea el mismo evento en hasta ${MAX_NIVELES_COMPARTIDOS - 1} niveles adicionales (misma hora/advisor/zoom). Para el advisor cuenta como 1 sola hora.`
                        : (compartibleMotivo || 'Selecciona primero un nivel y step compartible.')}
                    </p>
                  </div>
                </div>

                {compartidoActivo && compartibleHabilitado && (
                  <div className="mt-4 space-y-2">
                    {compartidoCon.map((c, idx) => (
                      <div key={idx} className="flex items-end gap-2 flex-wrap">
                        <div className="flex-1 min-w-[140px]">
                          <label className="block text-xs text-gray-600 mb-1">Nivel adicional #{idx + 1}</label>
                          <select
                            value={c.nivel}
                            onChange={e => actualizarNivelCompartido(idx, e.target.value)}
                            className="input w-full"
                          >
                            <option value="">— Seleccionar nivel —</option>
                            {codigosNivel
                              .filter(code => !nivelesUsados.has(code) || code === c.nivel)
                              .map(code => (
                                <option key={code} value={code}>{code}</option>
                              ))}
                          </select>
                        </div>
                        <div className="flex-1 min-w-[160px]">
                          <label className="block text-xs text-gray-600 mb-1">Step / Club</label>
                          <select
                            value={c.step}
                            onChange={e => actualizarStepCompartido(idx, e.target.value)}
                            className="input w-full"
                            disabled={!c.nivel}
                          >
                            <option value="">— Seleccionar —</option>
                            {c.options.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => quitarNivelCompartido(idx)}
                          className="text-xs text-red-600 hover:text-red-800 px-2 py-1.5"
                          title="Quitar este nivel del grupo"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {compartidoCon.length < MAX_NIVELES_COMPARTIDOS - 1 && (
                      <button
                        type="button"
                        onClick={agregarNivelCompartido}
                        className="text-xs text-indigo-700 hover:text-indigo-900 font-medium"
                      >
                        + Agregar nivel ({compartidoCon.length + 1} de {MAX_NIVELES_COMPARTIDOS - 1})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Banner informativo en EDIT de evento compartido */}
            {isEditMode && (editingEvent as any)?.eventoCompartidoId && (
              <div className="border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg p-3 text-sm text-indigo-900">
                <strong>🔗 Evento compartido entre niveles.</strong> Los cambios en
                advisor, hora, link de Zoom u observaciones se propagarán a los demás
                eventos del grupo. Nivel y step se mantienen por evento.
              </div>
            )}

            {/* Observaciones */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Observaciones
              </label>
              <textarea
                value={formData.observaciones}
                onChange={(e) => handleInputChange('observaciones', e.target.value)}
                className="input w-full"
                rows={3}
                placeholder="Notas adicionales sobre el evento"
              />
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary"
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    {editingEvent ? 'Actualizando...' : 'Creando...'}
                  </div>
                ) : (
                  editingEvent ? 'Actualizar Evento' : 'Crear Evento'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Modal de confirmación de cambio de advisor (Ctrl Horas hook) */}
      {pendingAdvisorChange && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              ⚠️ Confirmar cambio de advisor
            </h3>
            <p className="text-sm text-gray-700 mb-4">
              Esta acción registrará en el historial de <strong>{pendingAdvisorChange.oldAdvisorName}</strong> que
              la sesión fue cancelada para él/ella y se reasigna a <strong>{pendingAdvisorChange.newAdvisorName}</strong>.
              Las notas (Time Out y observaciones) que haya escrito el advisor anterior quedarán congeladas en su historial.
            </p>
            <label className="flex items-start gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmReassignChecked}
                onChange={(e) => setConfirmReassignChecked(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
              />
              <span className="text-sm text-gray-800">
                Confirmo: <strong>{pendingAdvisorChange.oldAdvisorName}</strong> canceló la sesión y se reasigna a <strong>{pendingAdvisorChange.newAdvisorName}</strong>
              </span>
            </label>
            {/* Restructuración: skip ADVISOR_EVENT_LOG — mismo patrón que el
                modal de Cancelar Evento. Útil para fix de planificación
                donde el advisor original NO canceló realmente. */}
            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={reassignSkipLog}
                onChange={(e) => setReassignSkipLog(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-800">
                Restructuración
                <span className="block text-xs text-gray-500 mt-0.5">
                  La reasignación se aplica pero <strong>NO queda registro</strong> en Ctrl Horas del advisor original.
                </span>
              </span>
            </label>
            <div className="mb-4">
              <label htmlFor="reassign-motivo" className="block text-xs font-medium text-gray-700 mb-1">
                Motivo (opcional)
              </label>
              <textarea
                id="reassign-motivo"
                value={reassignMotivo}
                onChange={(e) => setReassignMotivo(e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                placeholder="Ej: el advisor original tuvo un imprevisto familiar"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelAdvisorReassignment}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmAdvisorReassignment}
                disabled={!confirmReassignChecked}
                className="px-4 py-2 text-sm font-semibold text-white bg-yellow-600 rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirmar reasignación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal BLOQUEANTE: el evento tiene inscritos y se intentó cambiar
          nivel/step. Sólo permite Salir — el admin debe primero cancelar
          las inscripciones o crear un evento nuevo con el nivel correcto. */}
      {nivelChangeBlocked && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              🚫 No se puede cambiar el nivel
            </h3>
            <p className="text-sm text-gray-700 mb-4">
              Este evento tiene <strong>{nivelChangeBlocked.inscritos}</strong> estudiante(s) inscrito(s).
              Cambiar el nivel o step corromperá sus historiales de bookings.
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 text-sm">
              <div className="text-gray-500 text-xs">Cambio intentado</div>
              <div className="font-medium text-gray-900">
                {nivelChangeBlocked.oldLabel} → {nivelChangeBlocked.newLabel}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Para cambiar el nivel: cancela las inscripciones primero, o crea un evento nuevo con el nivel correcto.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setNivelChangeBlocked(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded hover:bg-gray-800"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de cambio de nivel/step — sólo se llega aquí
          si inscritos === 0. Botón Confirmar / Cancelar. No pide motivo. */}
      {pendingNivelChange && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              ⚠️ Confirmar cambio de nivel
            </h3>
            <p className="text-sm text-gray-700 mb-4">
              Vas a cambiar el nivel/step del evento. Esta acción <strong>NO queda registrada</strong>
              en Ctrl Horas (no es una cancelación para el advisor).
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 text-sm space-y-2">
              <div>
                <div className="text-gray-500 text-xs">Antes</div>
                <div className="font-medium text-gray-900">{pendingNivelChange.oldLabel}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">Después</div>
                <div className="font-medium text-blue-700">{pendingNivelChange.newLabel}</div>
              </div>
            </div>
            <p className="text-xs text-emerald-700 mb-4">
              ✓ Evento sin inscritos — el cambio es seguro.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelNivelChange}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmNivelChange}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}