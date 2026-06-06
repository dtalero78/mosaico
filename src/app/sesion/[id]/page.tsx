'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { CalendarIcon, ClockIcon, UserGroupIcon, ExclamationTriangleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import SessionTabs from '@/components/session/SessionTabs'
import SessionGeneralTab from '@/components/session/SessionGeneralTab'
import SessionStudentsTab from '@/components/session/SessionStudentsTab'
import SessionMaterialTab from '@/components/session/SessionMaterialTab'
import SessionAdvisorMaterialTab from '@/components/session/SessionAdvisorMaterialTab'
import { getSessionWindow, EXPIRED_MESSAGE } from '@/lib/session-window'

interface CalendarioEvent {
  _id: string
  nombreEvento: string
  evento: 'SESSION' | 'CLUB' | 'WELCOME'
  dia: string
  advisor: string                          // ADVISORS._id (UUID)
  advisorNombreCompleto?: string | null    // viene del JOIN del endpoint
  advisorPrimerNombre?: string | null
  advisorPrimerApellido?: string | null
  tituloONivel: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
  nivel?: string
  step?: string
  // Ctrl Horas
  timeout?: string | null
  notasadvisor?: string | null
  sesionCerrada?: boolean
  fechaCierreSesion?: string | null
  motivoCierre?: 'NORMAL' | 'SIN_ASISTENTES' | 'GESTION_COORDINADOR' | null
}

interface Student {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  email?: string
  celular?: string
  plataforma?: string
  edad?: number
  pais?: string
  hobbies?: string
  foto?: string
  nivel?: string
  step?: string
}

interface ClassRecord {
  _id: string
  idEstudiante: string
  idEvento: string
  asistencia: boolean
  participacion: boolean
  noAprobo?: boolean
  calificacion?: string
  comentarios?: string
  advisorAnotaciones?: string
  actividadPropuesta?: string
  nivel?: string
  step?: string
}

interface StudentWithClass extends Student {
  pruebainter?: string | null
  classRecord?: ClassRecord
}

export default function SesionPage() {
  const params = useParams()
  const router = useRouter()
  const eventoId = params.id as string
  const { data: session } = useSession()
  const role = (session?.user as any)?.role

  const [loading, setLoading] = useState(true)
  const [evento, setEvento] = useState<CalendarioEvent | null>(null)
  const [students, setStudents] = useState<StudentWithClass[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentWithClass | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Hermanos del grupo compartido (si el evento pertenece a uno). Cargado en
  // paralelo al montaje — alimenta el banner y el modal "Continuar al siguiente".
  const [groupSiblings, setGroupSiblings] = useState<any[]>([])
  // Reloj que tick cada 30s para que las ventanas (canMark, canRegister, expired)
  // se recalculen sin necesidad de recargar la página manualmente.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Estado de la ventana — visible para todos los hijos. Coordinator bypassea
  // todo (canMark/canRegister=true, isExpired=false). Si aún no carga el evento,
  // todo cae a defaults seguros (no se renderizan acciones hasta tener fecha).
  const windowState = useMemo(
    () => getSessionWindow(evento?.dia ?? null, role, now),
    [evento?.dia, role, now],
  )

  useEffect(() => {
    if (eventoId) {
      loadEventoData()
    }
  }, [eventoId])

  const loadEventoData = async () => {
    try {
      setLoading(true)

      // Cargar datos del evento
      const eventoResponse = await fetch(`/api/postgres/events/${eventoId}`)
      if (!eventoResponse.ok) throw new Error('Error al cargar evento')

      const eventoData = await eventoResponse.json()
      if (!eventoData.success) throw new Error(eventoData.error)

      setEvento(eventoData.event)

      // Cargar estudiantes inscritos
      await loadStudents()

      // Cargar hermanos del grupo (fire-and-forget — si falla no rompe la página)
      fetch(`/api/postgres/events/${eventoId}/group`)
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (j?.isShared && Array.isArray(j.siblings)) {
            setGroupSiblings(j.siblings)
          } else {
            setGroupSiblings([])
          }
        })
        .catch(() => setGroupSiblings([]))

    } catch (err) {
      console.error('Error loading evento:', err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const loadStudents = async () => {
    try {
      // Obtener bookings del evento
      const bookingsResponse = await fetch(`/api/postgres/events/${eventoId}/bookings?includeStudent=true`)

      if (!bookingsResponse.ok) throw new Error('Error al cargar estudiantes')

      const bookingsData = await bookingsResponse.json()

      if (bookingsData.success && bookingsData.bookings) {
        // Map integer calificacion back to text labels for the dropdown
        const calificacionReverseMap: Record<number, string> = {
          10: 'Excelente', 8: 'Muy Bien', 6: 'Bien', 4: 'Regular', 2: 'Necesita Mejorar',
        }

        const studentsWithClasses: StudentWithClass[] = bookingsData.bookings.map((booking: any) => {
          const calNum = typeof booking.calificacion === 'number' ? booking.calificacion : parseInt(booking.calificacion)
          const calText = !isNaN(calNum) ? (calificacionReverseMap[calNum] || String(calNum)) : (booking.calificacion || '')

          return {
            _id: booking.idEstudiante,
            primerNombre: booking.primerNombre,
            primerApellido: booking.primerApellido,
            email: booking.email,
            plataforma: booking.plataforma,
            edad: booking.edad,
            pais: booking.pais,
            hobbies: booking.hobbies || '',
            pruebainter: booking.studentPruebaInter ?? null,
            classRecord: {
              _id: booking._id,
              idEstudiante: booking.idEstudiante,
              idEvento: booking.eventoId || booking.idEvento,
              asistencia: booking.asistio ?? booking.asistencia ?? false,
              participacion: booking.participacion ?? false,
              noAprobo: booking.noAprobo ?? false,
              calificacion: calText,
              comentarios: booking.comentarios || '',
              advisorAnotaciones: booking.advisorAnotaciones || '',
              actividadPropuesta: booking.actividadPropuesta || '',
              nivel: booking.nivel,
              step: booking.step,
            },
          }
        })

        setStudents(studentsWithClasses)

        // Update selectedStudent if it exists so the form reflects saved data
        if (selectedStudent) {
          const updated = studentsWithClasses.find((s: StudentWithClass) => s._id === selectedStudent._id)
          if (updated) setSelectedStudent(updated)
        }
      }
    } catch (err) {
      console.error('Error loading students:', err)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando sesión...</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  if (error || !evento) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">{error || 'Evento no encontrado'}</div>
        </div>
      </DashboardLayout>
    )
  }

  // Asistentes ya marcados (para la rama "sin asistentes" del registro).
  const totalConAsistencia = students.filter(s =>
    s.classRecord?.asistencia === true || (s.classRecord as any)?.asistio === true,
  ).length

  // Para mostrar banners coherentes:
  //   - Si la sesión ya está cerrada → no mostramos nada (badge ✓ del botón ya lo dice).
  //   - Si está EN CURSO (0..+120) Y no cerrada → banner ámbar "Sesión en curso"
  //     (con countdown del momento límite para registrar).
  //   - Si expiró Y advisor (no coordinator) → banner ámbar bloqueante.
  //   - Si es coordinator entrando a una sesión vencida → banner azul informativo.
  const sesionCerrada = evento.sesionCerrada === true
  const showInProgressBanner = !sesionCerrada
    && windowState.minutesElapsed >= 0
    && windowState.minutesElapsed <= 120
  const showExpiredAdvisorBanner = !sesionCerrada && windowState.isExpired
  const showCoordinatorBanner = !sesionCerrada && windowState.isCoordinator && windowState.minutesElapsed > 120

  // Info del grupo compartido. El siguiente hermano para el flujo guiado
  // es el primero (alfabético por nivel) que NO sea el actual Y aún esté
  // sin cerrar. Si no hay → fin del flujo, redirigir a /panel-advisor.
  const isShared = groupSiblings.length > 1
  const indexInGroup = isShared ? groupSiblings.findIndex(s => s._id === eventoId) : -1
  const nextSibling = isShared
    ? (groupSiblings.find(s => s._id !== eventoId && s.sesionCerrada !== true) || null)
    : null

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.IR_A_SESION}>
        <div className="space-y-6">
          {/* Banner: sesión EN CURSO (entre 0 y +120 min) */}
          {showInProgressBanner && (
            <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-4 flex items-start gap-3">
              <ClockIcon className="h-6 w-6 text-amber-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  Sesión en curso · iniciada hace {windowState.minutesElapsed} min
                </p>
                <p className="text-sm text-amber-800 mt-0.5">
                  {windowState.canRegister
                    ? <>Recuerda <strong>marcar asistencia</strong> y luego <strong>registrar la sesión</strong>. {windowState.minutesUntilExpire !== null && <>Tienes {windowState.minutesUntilExpire} min antes de que se cierre la ventana de registro.</>}</>
                    : windowState.minutesUntilRegister !== null
                      ? <>Ya puedes <strong>marcar asistencia</strong>. El botón "Registrar Sesión" se habilita en {windowState.minutesUntilRegister} min.</>
                      : <>Ya puedes marcar asistencia y registrar la sesión.</>
                  }
                </p>
              </div>
            </div>
          )}

          {/* Banner expirado (advisor) */}
          {showExpiredAdvisorBanner && (
            <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r-lg p-4 flex items-start gap-3">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Período de registro vencido</p>
                <p className="text-sm text-amber-800 mt-0.5">{EXPIRED_MESSAGE}</p>
              </div>
            </div>
          )}
          {/* Banner gestión coordinador */}
          {showCoordinatorBanner && (
            <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4 flex items-start gap-3">
              <ShieldCheckIcon className="h-6 w-6 text-blue-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-900">Estás gestionando como Coordinador / Admin</p>
                <p className="text-sm text-blue-800 mt-0.5">
                  Esta sesión venció su ventana del advisor ({windowState.minutesElapsed} min desde el inicio).
                  Puedes marcar asistencia y registrar el cierre — quedará auditado con motivo <code>GESTION_COORDINADOR</code>.
                </p>
              </div>
            </div>
          )}

          {/* Banner: evento compartido entre niveles — muestra el progreso del
              flujo (chips con cada hermano y su estado). El cierre de cada
              uno es independiente; al cerrar uno, ofrecemos continuar con el
              siguiente sin cerrar (orden alfabético por nivel). */}
          {isShared && (
            <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-r-lg p-4 flex items-start gap-3 flex-wrap">
              <div className="flex-shrink-0 text-2xl" aria-hidden>🔗</div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-semibold text-indigo-900">
                  Sesión compartida entre {groupSiblings.length} niveles
                  {indexInGroup >= 0 && <> · paso {indexInGroup + 1} de {groupSiblings.length}</>}
                </p>
                <p className="text-xs text-indigo-800 mt-0.5">
                  Marca asistencia y registra esta sesión. Al cerrar, te ofreceremos continuar con el siguiente nivel.
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {groupSiblings.map(s => {
                  const isCurrent = s._id === eventoId
                  const closed = s.sesionCerrada === true
                  return (
                    <span
                      key={s._id}
                      className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                        closed
                          ? 'bg-emerald-100 text-emerald-800'
                          : isCurrent
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-indigo-700 border border-indigo-300'
                      }`}
                      title={`${s.nivel || '—'}${closed ? ' · cerrado' : isCurrent ? ' · actual' : ' · pendiente'}`}
                    >
                      {closed ? '✓ ' : isCurrent ? '⏳ ' : '○ '}
                      {s.nivel || s._id.slice(-4)}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Header */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">
                  {evento.tituloONivel} - {evento.nombreEvento}
                </h1>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <CalendarIcon className="h-4 w-4" />
                    <span>{format(new Date(evento.dia), "EEEE, d 'de' MMMM", { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <ClockIcon className="h-4 w-4" />
                    <span>{format(new Date(evento.dia), 'HH:mm', { locale: es })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <UserGroupIcon className="h-4 w-4" />
                    <span>{students.length} / {evento.limiteUsuarios} estudiantes</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {evento.linkZoom && (
                  <a
                    href={evento.linkZoom}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Ir a Zoom
                  </a>
                )}
                <RegistrarSesionButton
                  evento={evento}
                  windowState={windowState}
                  totalInscritos={students.length}
                  totalConAsistencia={totalConAsistencia}
                  onClosed={() => loadEventoData()}
                  isShared={isShared}
                  nextSibling={nextSibling}
                  groupSize={groupSiblings.length}
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <SessionTabs>
            {{
              general: (
                <SessionGeneralTab
                  evento={evento}
                  studentCount={students.length}
                />
              ),
              students: (
                <SessionStudentsTab
                  evento={evento}
                  students={students}
                  selectedStudent={selectedStudent}
                  onStudentSelect={setSelectedStudent}
                  onDataUpdate={loadStudents}
                  canMarkAttendance={windowState.canMarkAttendance && !sesionCerrada}
                  attendanceLockedReason={
                    sesionCerrada
                      ? 'La sesión ya está cerrada — los registros son de solo lectura.'
                      : windowState.isExpired
                        ? EXPIRED_MESSAGE
                        : (windowState.minutesElapsed < 0 && !windowState.isCoordinator)
                          ? `El evento comienza a las ${format(new Date(evento.dia), 'HH:mm')} (faltan ${Math.abs(windowState.minutesElapsed)} min) — podrás marcar asistencia cuando inicie.`
                          : null
                  }
                />
              ),
              material: (
                <SessionMaterialTab
                  eventoNombre={evento.nombreEvento}
                />
              ),
              advisorMaterial: (
                <SessionAdvisorMaterialTab
                  step={evento.step || ''}
                  nivel={evento.nivel || ''}
                />
              )
            }}
          </SessionTabs>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}

/**
 * Botón "Registrar Sesión" (Ctrl Horas V2 — ventana +120 min + sin asistentes):
 *
 * Visibilidad:
 *   - Advisor asignado al evento → siempre visible
 *   - COORDINADOR_ACADEMICO / SUPER_ADMIN / ADMIN → siempre visible (bypass)
 *   - Otro advisor / rol sin permiso → null
 *
 * Estados del botón:
 *   - sesionCerrada=true        → badge gris "✓ Sesión registrada"
 *   - elapsedMin < 30 (advisor) → countdown "Registro disponible en X min"
 *   - elapsedMin > 120 (advisor) → mensaje "Período vencido — Coordinador"
 *   - en ventana → botón verde "Registrar Sesión"
 *   - en ventana + sin asistencias marcadas → al clickear muestra modal de
 *     confirmación "¿La clase no tuvo asistentes?" antes del modal normal
 *
 * Aviso suave (beforeunload):
 *   - Advisor en ventana operativa con sesión sin cerrar → confirma salida
 */
function RegistrarSesionButton({
  evento,
  windowState,
  totalInscritos,
  totalConAsistencia,
  onClosed,
  isShared,
  nextSibling,
  groupSize,
}: {
  evento: CalendarioEvent
  windowState: ReturnType<typeof getSessionWindow>
  totalInscritos: number
  totalConAsistencia: number
  onClosed: () => void
  isShared: boolean
  nextSibling: any | null
  groupSize: number
}) {
  const router = useRouter()
  const { data: session } = useSession()

  const [isMyEvent, setIsMyEvent] = useState(false)
  const [requiereRegistro, setRequiereRegistro] = useState(true)
  // Step "confirmSinAsistentes" → "registrar" → "postCierreCompartido" → done
  const [step, setStep] = useState<'idle' | 'confirmSinAsistentes' | 'registrar' | 'postCierreCompartido'>('idle')
  const [sinAsistentes, setSinAsistentes] = useState(false)
  // Pre-carga de Time Out + Notas: si vienes del flujo guiado desde un
  // hermano del grupo, el sessionStorage trae los últimos valores para no
  // tener que reescribirlos. Se limpia tras leerse.
  const [timeoutVal, setTimeoutVal] = useState(() => {
    if (typeof window === 'undefined') return evento.timeout || ''
    const stored = window.sessionStorage.getItem('lgs-grupo-prefill-timeout')
    if (stored) {
      window.sessionStorage.removeItem('lgs-grupo-prefill-timeout')
      return stored
    }
    return evento.timeout || ''
  })
  const [notas, setNotas] = useState(() => {
    if (typeof window === 'undefined') return evento.notasadvisor || ''
    const stored = window.sessionStorage.getItem('lgs-grupo-prefill-notas')
    if (stored) {
      window.sessionStorage.removeItem('lgs-grupo-prefill-notas')
      return stored
    }
    return evento.notasadvisor || ''
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Resolver si el usuario logueado es el advisor del evento (necesario aún
  // para advisor; coordinator igual ve el botón sin importar)
  useEffect(() => {
    const email = (session?.user as any)?.email
    if (!email) return
    fetch(`/api/postgres/advisors/by-email/${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(j => {
        const myId = j.advisor?._id
        setIsMyEvent(!!myId && myId === evento.advisor)
      })
      .catch(() => setIsMyEvent(false))
    fetch(`/api/postgres/config/sesion-requiere-registro`)
      .then(r => r.json())
      .then(j => setRequiereRegistro(j.value !== false && j.value !== 'false'))
      .catch(() => { /* mantener default true */ })
  }, [session, evento.advisor])

  // beforeunload — se activa DESDE el inicio del evento (no solo desde +30).
  //
  // Ventanas:
  //   - Antes del inicio (minutesElapsed < 0): no aplica (no hay sesión aún).
  //   - Entre 0 y +30 min: aplica — el advisor debe marcar asistencia y NO
  //     debe salir antes de poder registrar (botón se habilita a +30).
  //   - Entre +30 y +120 min: aplica — debe registrar antes de cerrar.
  //   - >+120 (expired): NO aplica al advisor (no puede hacer nada). El
  //     coordinador sí puede seguir actuando, pero respetamos su decisión
  //     de cerrar la pestaña si quiere.
  //
  // Aplica para advisor propio O coordinator (cualquiera que esté gestionando).
  useEffect(() => {
    if (evento.sesionCerrada || !requiereRegistro) return
    const activeForAdvisor = isMyEvent && !windowState.isExpired && windowState.minutesElapsed >= 0
    const activeForCoord = windowState.isCoordinator && windowState.minutesElapsed >= 0
    if (!activeForAdvisor && !activeForCoord) return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'La sesión está en curso o pendiente de registrar. ¿Salir igual?'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [
    evento.sesionCerrada,
    requiereRegistro,
    isMyEvent,
    windowState.isExpired,
    windowState.isCoordinator,
    windowState.minutesElapsed,
  ])

  // Visibilidad: advisor propio o coordinator. Si nada de eso, no se renderiza.
  const canSee = isMyEvent || windowState.isCoordinator
  if (!canSee) return null

  // Sesión ya cerrada.
  // Si la cerró el Coordinador (motivoCierre='GESTION_COORDINADOR') porque
  // el advisor no la registró en su ventana → badge ROJO con texto extendido
  // para que el advisor sepa que no fue él quien la cerró.
  if (evento.sesionCerrada) {
    const cerradaPorCoord = evento.motivoCierre === 'GESTION_COORDINADOR'
    return (
      <span
        className={`px-3 py-2 text-sm font-medium rounded-lg ${
          cerradaPorCoord
            ? 'text-white bg-red-600'
            : 'text-gray-600 bg-gray-100'
        }`}
        title={cerradaPorCoord
          ? 'El Coordinador Académico registró esta sesión porque venció la ventana del advisor.'
          : 'Sesión registrada por el advisor.'}
      >
        ✓ Sesión registrada{cerradaPorCoord ? ' por Coordinación' : ''}
      </span>
    )
  }

  // Antes de la ventana de registro (solo aplica a advisor — coordinator
  // siempre puede)
  if (!windowState.canRegister && !windowState.isCoordinator) {
    if (windowState.isExpired) {
      return (
        <span className="px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg" title={EXPIRED_MESSAGE}>
          ⚠ Período vencido — Coordinador
        </span>
      )
    }
    if (windowState.minutesUntilRegister !== null) {
      // Si el evento ya empezó (minutesElapsed >= 0), marcar asistencia
      // mientras tanto. Si no, simplemente esperar.
      const yaEmpezo = windowState.minutesElapsed >= 0
      return (
        <span
          className={`px-3 py-2 text-xs italic rounded ${
            yaEmpezo ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-gray-500'
          }`}
          title={yaEmpezo ? 'Marca asistencia ahora; el botón Registrar se habilitará a los 30 min.' : 'Disponible 30 min después del inicio'}
        >
          {yaEmpezo
            ? `Marca asistencia · Registro en ${windowState.minutesUntilRegister} min`
            : `Registro disponible en ${windowState.minutesUntilRegister} min`}
        </span>
      )
    }
  }

  const TIMEOUT_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

  // Click en "Registrar Sesión":
  //   - Si totalInscritos > 0 Y totalConAsistencia === 0 → confirma sinAsistentes primero
  //   - Si no → directo al modal Time Out + Notas
  const handleClick = () => {
    setErr(null)
    if (!timeoutVal) {
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      setTimeoutVal(`${hh}:${mm}`)
    }
    if (totalInscritos > 0 && totalConAsistencia === 0) {
      setStep('confirmSinAsistentes')
    } else {
      setSinAsistentes(false)
      setStep('registrar')
    }
  }

  const confirmSinAsistentes = () => {
    setSinAsistentes(true)
    setStep('registrar')
  }

  async function submitClose() {
    if (!TIMEOUT_REGEX.test(timeoutVal)) {
      setErr('Time Out debe estar en formato HH:MM militar (ej. 09:30)')
      return
    }
    setSaving(true); setErr(null)
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' } catch { return 'America/Bogota' } })()
      // 1. Guardar timeout y notas
      const patchRes = await fetch(`/api/postgres/calendario/${evento._id}/notas-advisor`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: timeoutVal, notasadvisor: notas || null, tz }),
      })
      const patchJson = await patchRes.json()
      if (!patchRes.ok || !patchJson.success) throw new Error(patchJson.error || 'Error guardando notas')

      // 2. Cerrar sesión (con sinAsistentes si aplica)
      const closeRes = await fetch(`/api/postgres/calendario/${evento._id}/cerrar-sesion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinAsistentes }),
      })
      const closeJson = await closeRes.json()
      if (!closeRes.ok || !closeJson.success) throw new Error(closeJson.error || 'Error cerrando sesión')

      toast.success(sinAsistentes
        ? `Sesión registrada como SIN ASISTENTES (${closeJson.bookingsActualizados ?? 0} estudiantes marcados como no-asistido)`
        : 'Sesión registrada correctamente')
      setSinAsistentes(false)
      // Flujo guiado de evento compartido:
      //   - Si hay siguiente hermano sin cerrar → mostrar modal "Continuar"
      //   - Si NO hay (era el último) → redirige al panel del advisor
      //   - Si NO es compartido → cierra el modal normalmente y refresca
      if (isShared) {
        if (nextSibling) {
          setStep('postCierreCompartido')
        } else {
          // Último hermano cerrado: terminar flujo y volver al calendario.
          toast.success('🎉 Todos los niveles del grupo quedaron registrados.')
          setStep('idle')
          router.push('/panel-advisor')
        }
      } else {
        setStep('idle')
        onClosed()
      }
    } catch (e: any) {
      setErr(e?.message || 'Error inesperado')
    } finally {
      setSaving(false)
    }
  }

  // Navega al siguiente hermano del grupo. Pre-llena timeout + notas en
  // sessionStorage para que el siguiente render los lea y reutilice.
  function continuarConSiguiente() {
    if (!nextSibling) return
    try {
      if (typeof window !== 'undefined') {
        if (timeoutVal) window.sessionStorage.setItem('lgs-grupo-prefill-timeout', timeoutVal)
        if (notas)      window.sessionStorage.setItem('lgs-grupo-prefill-notas', notas)
      }
    } catch { /* sessionStorage puede fallar en modo incógnito */ }
    setStep('idle')
    router.push(`/sesion/${nextSibling._id}`)
  }

  function terminarFlujo() {
    setStep('idle')
    router.push('/panel-advisor')
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-semibold"
      >
        Registrar Sesión
      </button>

      {/* Modal A: confirmación "sin asistentes" — aparece ANTES del modal de registro
          si hay inscritos pero ninguno con asistencia marcada. */}
      {step === 'confirmSinAsistentes' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-amber-900 mb-3 flex items-center gap-2">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-600" />
              ¿Ningún estudiante asistió?
            </h3>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-900">
              No has marcado asistencia a ningún estudiante de los <strong>{totalInscritos}</strong> inscritos.
              Si confirmas, esta acción:
              <ul className="list-disc list-inside mt-2 space-y-0.5 text-amber-800">
                <li>Marcará a los {totalInscritos} estudiantes como <strong>no asistidos</strong>.</li>
                <li>Registrará la sesión con motivo <code className="bg-amber-100 px-1 rounded">SIN_ASISTENTES</code>.</li>
                <li>Continuarás al paso de Time Out + Notas.</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSinAsistentes}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
              >
                Sí, confirmar sin asistentes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal B: registrar (Time Out + Notas) */}
      {step === 'registrar' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Registrar Sesión
              {sinAsistentes && (
                <span className="ml-2 text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded">SIN ASISTENTES</span>
              )}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Esta acción cierra la sesión y la marca como atendida. No podrás editar
              Time Out ni Notas después de cerrar.
            </p>

            <div className="mb-3">
              <label htmlFor="timeout-input" className="block text-xs font-medium text-gray-700 mb-1">
                Time Out (HH:MM) <span className="text-red-600">*</span>
              </label>
              <input
                id="timeout-input"
                type="time"
                value={timeoutVal}
                onChange={e => setTimeoutVal(e.target.value)}
                required
                className="w-32 border border-gray-300 rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="notas-input" className="block text-xs font-medium text-gray-700 mb-1">
                Notas (opcional)
              </label>
              <textarea
                id="notas-input"
                value={notas}
                onChange={e => setNotas(e.target.value)}
                rows={3}
                placeholder='Si dejas vacío se guarda "no hubo novedades"'
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>

            {err && <div className="mb-3 text-sm text-red-600">{err}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setStep('idle'); setSinAsistentes(false) }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitClose}
                disabled={saving || !timeoutVal}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Confirmar Registro'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal C: post-cierre de evento compartido — ofrece continuar con
          el siguiente nivel del grupo o terminar el flujo. Solo aparece
          cuando hay nextSibling pendiente. */}
      {step === 'postCierreCompartido' && nextSibling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-emerald-900 mb-2 flex items-center gap-2">
              ✓ Sesión {evento.nivel || ''} registrada
            </h3>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-4 text-sm">
              <p className="font-medium text-indigo-900 mb-1">
                🔗 Esta clase es compartida entre {groupSize} niveles.
              </p>
              <p className="text-xs text-indigo-800">
                Continúa con el siguiente nivel —{' '}
                <strong>{nextSibling.nivel || 'siguiente'}</strong>
                {nextSibling.nombreEvento ? ` · ${nextSibling.nombreEvento}` : (nextSibling.step ? ` · ${nextSibling.step}` : '')}.
                Tu Time Out y notas quedan pre-llenadas con los valores que acabas de registrar.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={terminarFlujo}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Terminar (ir al panel)
              </button>
              <button
                type="button"
                onClick={continuarConSiguiente}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Continuar con {nextSibling.nivel || 'siguiente'} →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
