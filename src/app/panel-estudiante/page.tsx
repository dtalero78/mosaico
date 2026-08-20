'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import {
  CalendarDaysIcon,
  BookOpenIcon,
  ChartBarIcon,
  VideoCameraIcon,
  XMarkIcon,
  UserCircleIcon,
  SparklesIcon,
  ChevronDownIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import { useQuery } from 'react-query'
import {
  useStudentMe,
  useStudentEvents,
  useStudentStats,
  useStudentPanelProgress,
  useStudentMaterials,
  useStudentActividades,
  useStudentComments,
  useStudentHistory,
  useCancelBooking,
} from '@/hooks/use-panel-estudiante'

import StudentHeader from '@/components/panel-estudiante/StudentHeader'
import ZoomAccessButton from '@/components/panel-estudiante/ZoomAccessButton'
import MyEventsSection from '@/components/panel-estudiante/MyEventsSection'
import NivelacionProgramadaCard from '@/components/panel-estudiante/NivelacionProgramadaCard'
import EvaluacionCard from '@/components/panel-estudiante/EvaluacionCard'
import { formatDate } from '@/lib/utils'
import AttendanceStats from '@/components/panel-estudiante/AttendanceStats'
import BookingFlow from '@/components/panel-estudiante/BookingFlow'
import SinEvaluarCard from '@/components/panel-estudiante/SinEvaluarCard'
import EvaluacionModal from '@/components/panel-estudiante/EvaluacionModal'
import { useEvaluacionesPendientes } from '@/hooks/use-evaluations'
import ProgressReport from '@/components/panel-estudiante/ProgressReport'
import MaterialsList from '@/components/panel-estudiante/MaterialsList'
import WhatsAppContacts from '@/components/panel-estudiante/WhatsAppContacts'
import AdvisorComments from '@/components/panel-estudiante/AdvisorComments'
import ClassHistory from '@/components/panel-estudiante/ClassHistory'
import JumpExamBanner from '@/components/panel-estudiante/JumpExamBanner'
import { usePermissions } from '@/hooks/usePermissions'
import { StudentPermission } from '@/types/permissions'
import { ZOOM_ABRE_MIN_ANTES, ZOOM_CIERRA_MIN_DESPUES, MENSAJE_ZOOM_LISTO, MENSAJE_ZOOM_ESPERA } from '@/lib/zoom-window'

// La ventana de conexión a Zoom vive en `lib/zoom-window` (cliente+servidor),
// para que el número no quede escrito por separado en la lógica y en el texto.
// Tope de una espera de setTimeout (desborda pasados ~24 días): si al próximo
// cambio le falta más, se despierta a las 6 h y se reprograma el resto.
const ZOOM_MAX_ESPERA_MS = 6 * 60 * 60 * 1000

function PanelEstudianteContent() {
  // Contador que sólo sirve para re-evaluar la ventana de Zoom cuando llega la
  // hora (ver el efecto más abajo).
  const [zoomTick, setZoomTick] = useState(0)
  const [showBookingFlow, setShowBookingFlow] = useState(false)
  const [bookingTipo, setBookingTipo] = useState<string | undefined>(undefined)
  const [showProgress, setShowProgress] = useState(false)
  const [showMaterials, setShowMaterials] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoTitle, setVideoTitle] = useState<string>('')
  const [videoErr, setVideoErr] = useState(false)
  const [showPerfil, setShowPerfil] = useState(false)
  const [showActividades, setShowActividades] = useState(false)
  const [showRecursos, setShowRecursos] = useState(false)
  const [showInstructivos, setShowInstructivos] = useState(false)

  // Ticker
  const tickerQuery = useQuery(
    'ticker-config',
    () => fetch('/api/postgres/config/ticker').then(r => r.json()),
    { staleTime: 5 * 60 * 1000 }
  )
  const tickerMessage = tickerQuery.data?.message ?? '📢 Usuarios Ecuador 🇪🇨 y Chile 🇨🇱: viernes 3 y sábado 4 de abril no habra sesiones por Semana Santa ✝️. ¡Disfruten su descanso! 🌿✨ | Usuarios Colombia 🇨🇴: sábado 4 de abril habrán sesiones normales 👍'
  const tickerColor = tickerQuery.data?.color ?? '#ffffff'

  // Visibilidad (admin) de la caja "Lección ##" en el panel (IMPULSA). Default visible.
  const leccionVisibleQuery = useQuery(
    'panel-leccion-visible',
    () => fetch('/api/postgres/config/panel-leccion').then(r => r.json()).catch(() => ({ visible: true })),
    { staleTime: 60 * 1000 }
  )
  const leccionVisible = leccionVisibleQuery.data?.visible !== false

  // Instructivos: videos generales visibles para TODOS los estudiantes de todos
  // los cursos. Solo se listan los que tienen video subido (los "pendientes" no).
  const instructivosQuery = useQuery(
    'instructivos-config',
    () => fetch('/api/postgres/config/instructivos').then(r => r.json()),
    { staleTime: 10 * 60 * 1000 }
  )
  const instructivosConVideo: { id: number; title: string; description: string; videoKey: string }[] =
    (instructivosQuery.data?.instructivos ?? []).filter((i: any) => i?.videoKey)

  // Queries
  const meQuery = useStudentMe()
  const eventsQuery = useStudentEvents()
  const statsQuery = useStudentStats()
  const progressQuery = useStudentPanelProgress()
  const materialsQuery = useStudentMaterials()
  const actividadesQuery = useStudentActividades()
  const commentsQuery = useStudentComments()
  const historyQuery = useStudentHistory()

  // Mutations
  const cancelMutation = useCancelBooking()

  // Permiso del botón "Ver video" (rol ESTUDIANTE). Mientras cargan los permisos
  // se muestra (optimista) para no ocultarlo por defecto; sólo se oculta si el rol
  // NO tiene STUDENT.PANEL.VER_VIDEO. Admin/SuperAdmin siempre lo ven.
  const { hasPermission, isLoading: permsLoading } = usePermissions()
  const canVerVideo = permsLoading || hasPermission(StudentPermission.PANEL_VER_VIDEO as any)

  const profile = meQuery.data?.profile
  const events = eventsQuery.data?.events || []
  // La nivelación agendada (booking tipo=NIVELACION) se muestra en su propia caja;
  // el resto de eventos van en la agenda semanal.
  const nivelacionBooking = events.find((e: any) => (e.tipo || e.tipoEvento) === 'NIVELACION') || null
  // Fin de la SEMANA SIGUIENTE (domingo, 23:59) — la agenda muestra sólo la semana
  // en curso + la siguiente (2 semanas lunes-domingo).
  const finSemanaSiguiente = (() => {
    const n = new Date()
    const diasAlDomingo = (7 - n.getDay()) % 7 // 0=hoy es domingo
    const fin = new Date(n)
    fin.setDate(n.getDate() + diasAlDomingo + 7) // domingo de la semana siguiente
    fin.setHours(23, 59, 59, 999)
    return fin
  })()
  const weeklyEvents = events.filter((e: any) =>
    (e.tipo || e.tipoEvento) !== 'NIVELACION' &&
    e.fechaEvento && new Date(e.fechaEvento) <= finSemanaSiguiente
  )

  // Fondo suave de la tarjeta de curso según el tipo de curso (clases literales para Tailwind)
  const CURSO_BG: Record<string, string> = {
    YOJI: 'bg-green-50 border border-green-100',
    OKINA: 'bg-yellow-50 border border-yellow-100',
    KODOMO: 'bg-blue-50 border border-blue-100',
    DANSHI: 'bg-orange-50 border border-orange-100',
    SENPAI: 'bg-red-50 border border-red-100',
    IMPULSA: 'bg-fuchsia-50 border border-fuchsia-100',
  }
  const cursoBg = CURSO_BG[(profile?.tipoCurso || '').toUpperCase()] || 'bg-gray-50 border border-gray-100'
  // IMPULSA opera distinto: sin talleres/olimpiadas/actividades/recursos ni nivelaciones.
  const esImpulsa = (profile?.tipoCurso || '').toUpperCase() === 'IMPULSA'
  // Título de la caja "Lección ##" (sólo IMPULSA): número de la lección actual.
  const leccionNum = (profile?.step || '').match(/\d+/)?.[0]
  const leccionTitulo = leccionNum ? `Lección ${leccionNum}` : 'Lección actual'

  // Derive next class info for student card
  const nextClass = useMemo(() => {
    if (!events || events.length === 0) return null
    return events[0]
  }, [events])

  const handleCancel = (bookingId: string) => {
    if (confirm('Estas seguro de que quieres cancelar esta clase?')) {
      cancelMutation.mutate(bookingId)
    }
  }

  // Soft prompt: si hay evaluaciones pendientes (semana actual, asistidas, sin evaluar),
  // al hacer click en "Agendar" abrimos el modal de evaluación con la PRIMERA pendiente.
  // El usuario puede evaluar y luego continuar, o usar "Evaluar más tarde y agendar"
  // para bypassear y abrir el wizard normal (la pendiente sigue en la lista).
  const evalPendientesQuery = useEvaluacionesPendientes()
  const pendientesRows = evalPendientesQuery.data?.featureEnabled ? (evalPendientesQuery.data.rows ?? []) : []
  const [softPrompt, setSoftPrompt] = useState<{ tipo?: string } | null>(null)

  const openBooking = (tipo?: string) => {
    if (pendientesRows.length > 0) {
      setSoftPrompt({ tipo })
      return
    }
    setBookingTipo(tipo)
    setShowBookingFlow(true)
  }

  /** "Evaluar más tarde y agendar" — bypass + abre wizard. */
  const handleEvaluarMasTarde = () => {
    const tipo = softPrompt?.tipo
    setSoftPrompt(null)
    setBookingTipo(tipo)
    setShowBookingFlow(true)
  }

  const handleOpenVideo = () => {
    const nivel = profile?.nivel
    // Always use profile?.step (the student's actual step in ACADEMICA).
    // nextClass?.step can be "TRAINING - Step 7" which doesn't exist in NIVELES.
    const step = profile?.effectiveStep || profile?.step
    if (!nivel || !step) return
    setVideoTitle('')
    setVideoErr(false)
    setVideoSrc(`/api/postgres/niveles/video?nivel=${encodeURIComponent(nivel)}&step=${encodeURIComponent(step)}`)
    setVideoOpen(true)
  }

  const nextEventDate = nextClass ? new Date(nextClass.fechaEvento) : null
  // `zoomTick` sólo existe para volver a evaluar la ventana cuando llega la hora
  // (ver el efecto de abajo): sin él, `now` queda congelado en el instante en que
  // cargó la página y el ícono no cambiaría hasta recargar.
  const now = new Date()
  // Ventana de conexión: se abre 5 min ANTES del inicio y se cierra 15 min DESPUÉS.
  // Fuera de ella el ícono queda bloqueado y avisa que no es la hora.
  const minutosAlInicio = nextEventDate ? (nextEventDate.getTime() - now.getTime()) / (1000 * 60) : Infinity
  const showZoom = !!nextClass && !!nextEventDate
    && minutosAlInicio <= ZOOM_ABRE_MIN_ANTES
    && -minutosAlInicio <= ZOOM_CIERRA_MIN_DESPUES
  const zoomLink = nextClass?.eventLinkZoom || nextClass?.linkZoom

  // El ícono de Zoom se activa/desactiva SOLO, sin recargar: se programa un aviso
  // para el instante exacto del próximo cambio (apertura y luego cierre) en vez de
  // despertar cada pocos segundos sin necesidad. Al dispararse, el efecto vuelve a
  // correr y programa el siguiente. La hora es la del dispositivo del alumno, igual
  // que el resto del cálculo.
  const inicioMs = nextEventDate ? nextEventDate.getTime() : null
  useEffect(() => {
    if (inicioMs == null) return
    const abre = inicioMs - ZOOM_ABRE_MIN_ANTES * 60_000
    const cierra = inicioMs + ZOOM_CIERRA_MIN_DESPUES * 60_000
    const ahora = Date.now()
    const proximoCambio = ahora < abre ? abre : ahora < cierra ? cierra : null
    if (proximoCambio == null) return // la ventana ya se cerró: nada que programar

    // Se acota la espera: setTimeout desborda pasados ~24 días y dispararía al
    // instante. Si falta más, se despierta antes y se reprograma el resto.
    const espera = Math.min(proximoCambio - ahora + 1_000, ZOOM_MAX_ESPERA_MS)
    const id = setTimeout(() => setZoomTick(t => t + 1), espera)
    return () => clearTimeout(id)
  }, [inicioMs, zoomTick])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 1. Top Bar: WhatsApp + Greeting + Nivel */}
      <StudentHeader profile={profile} isLoading={meQuery.isLoading} />

      {/* 2. Booking Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="mx-auto px-2 flex flex-wrap items-center gap-3">
          <span className="text-lg font-bold text-primary-700 mr-2">MOSAICO</span>
          {!esImpulsa && (<>
          <span className="text-sm text-gray-500 mr-1">Booking:</span>
          <button
            type="button"
            onClick={() => openBooking('CLUB')}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5"
          >
            <CalendarDaysIcon className="h-4 w-4" />
            Inscripción Talleres
          </button>
          <button
            type="button"
            onClick={() => openBooking('OLIMPIADA')}
            className="px-4 py-2 bg-yellow-400 text-gray-900 text-sm font-semibold rounded-lg hover:bg-yellow-500 transition-colors flex items-center gap-1.5"
          >
            <CalendarDaysIcon className="h-4 w-4" />
            Inscripción Olimpiadas
          </button>
          </>)}

          <div className="flex-1" />

          {!esImpulsa && (<>
          {/* Grupo desplegable Actividades */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowActividades(v => !v)}
              className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <SparklesIcon className="h-4 w-4" />
              Actividades
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${showActividades ? 'rotate-180' : ''}`} />
            </button>
            {showActividades && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowActividades(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                  {/* WordWall de la lección (Kahoot descontinuado) */}
                  {actividadesQuery.data?.wordwall && (
                    <a href={actividadesQuery.data.wordwall} target="_blank" rel="noopener noreferrer"
                      onClick={() => setShowActividades(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <span className="inline-block w-2 h-2 rounded-full bg-pink-500" /> {actividadesQuery.data.wordwallNombre || 'WordWall'}
                    </a>
                  )}
                  {/* WordWall del módulo (lista abierta) */}
                  {(actividadesQuery.data?.actividadesWordwall || []).length > 0 && (
                    <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-gray-100 mt-1">Del módulo</p>
                  )}
                  {(actividadesQuery.data?.actividadesWordwall || []).map((act: { nombre: string; link: string }, i: number) => (
                    <a key={i} href={act.link} target="_blank" rel="noopener noreferrer"
                      onClick={() => setShowActividades(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <span className="inline-block w-2 h-2 rounded-full bg-pink-500" /> {act.nombre || 'WordWall'}
                    </a>
                  ))}
                  {!actividadesQuery.data?.wordwall
                    && (actividadesQuery.data?.actividadesWordwall || []).length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin actividades para tu módulo/lección</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Grupo desplegable Recursos (links del módulo) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRecursos(v => !v)}
              className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <LinkIcon className="h-4 w-4" />
              Recursos
              <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${showRecursos ? 'rotate-180' : ''}`} />
            </button>
            {showRecursos && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowRecursos(false)} />
                <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-72 overflow-y-auto">
                  {(actividadesQuery.data?.recursos || []).length > 0 ? (
                    actividadesQuery.data.recursos.map((rec: { nombre: string; link: string }, i: number) => (
                      <a key={i} href={rec.link} target="_blank" rel="noopener noreferrer"
                        onClick={() => setShowRecursos(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        <span className="inline-block w-2 h-2 rounded-full bg-fuchsia-500 flex-shrink-0" />
                        <span className="truncate">{rec.nombre || rec.link}</span>
                      </a>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-gray-400">Sin recursos para tu módulo</p>
                  )}
                </div>
              </>
            )}
          </div>
          </>)}

          <button
            onClick={() => setShowMaterials(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <BookOpenIcon className="h-4 w-4" />
            Material
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <BookOpenIcon className="h-4 w-4" />
            Historial
          </button>
          <button
            onClick={() => setShowProgress(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <ChartBarIcon className="h-4 w-4" />
            Como voy?
          </button>
          {instructivosConVideo.length > 0 && (
            <button
              onClick={() => setShowInstructivos(true)}
              className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <VideoCameraIcon className="h-4 w-4" />
              Instructivos
            </button>
          )}
          <button
            onClick={() => setShowPerfil(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <UserCircleIcon className="h-4 w-4" />
            Perfil
          </button>
        </div>
      </div>

      {/* News Ticker Banner */}
      <div className="bg-gray-900 overflow-hidden flex items-stretch">
        <style>{`
          @keyframes lgs-ticker {
            0%   { transform: translateX(100vw); }
            100% { transform: translateX(-100%); }
          }
          .lgs-ticker-text {
            display: inline-block;
            white-space: nowrap;
            animation: lgs-ticker 35s linear infinite;
          }
        `}</style>
        <div className={`flex-shrink-0 flex items-center justify-center min-w-[200px] px-4 py-2 gap-2 ${esImpulsa ? 'bg-white' : 'bg-primary-600'}`}>
          {esImpulsa ? (
            <img src="/logo-impulsa.png" alt="IMPULSA" className="h-7 w-auto object-contain" />
          ) : (
            <span className="text-white text-xs font-black uppercase tracking-widest">📢 MOSAICO</span>
          )}
        </div>
        <div className="flex-1 overflow-hidden flex items-center py-2">
          <span className="lgs-ticker-text text-sm font-medium px-8" style={{ color: tickerColor }}>
            {tickerMessage}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 pt-8 pb-6 space-y-6">
        {/* Jump exam banner (only when eligible) */}
        <JumpExamBanner />

        {/* Fila superior: detalle del curso + próxima sesión (izq) | Sesiones (der) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Izquierda: imagen del curso + Curso/Campaña/Salón + Guía + NEXT SESSION */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {meQuery.isLoading ? (
              <div className="h-[21.5rem] bg-gray-100 animate-pulse" />
            ) : profile?.cursoImagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.cursoImagenUrl} alt={profile?.tipoCurso || 'Curso'} className="w-full h-[21.5rem] object-contain bg-gray-50" />
            ) : (
              <div className="h-[21.5rem] flex flex-col items-center justify-center bg-gradient-to-br from-primary-50 to-accent/10 text-gray-400 gap-2">
                <BookOpenIcon className="h-10 w-10" />
                <span className="text-sm">{profile?.tipoCurso || 'Curso'}</span>
              </div>
            )}
            <div className="p-4 space-y-3">
              {/* Curso + Guía — fondo con el color del curso */}
              <div className={`rounded-lg p-3 space-y-2 ${cursoBg}`}>
                {/* Curso · Campaña · Salón */}
                {profile?.tipoCurso && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-sm font-bold text-gray-900">{profile.tipoCurso}</span>
                    {profile?.campaign && <span className="text-xs text-gray-600">Campaña: {profile.campaign}</span>}
                    {profile?.salon && <span className="text-xs text-gray-600">Salón: {profile.salon}</span>}
                  </div>
                )}
                {/* Guía */}
                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Guía</span>
                  <p className="text-sm font-medium text-gray-900">{profile?.cursoGuia || nextClass?.advisorNombre || '---'}</p>
                </div>
              </div>
              {/* SESSION PRÓXIMA — fondo morado suave */}
              <div className="rounded-lg p-3 space-y-3 bg-primary-50 border border-primary-100">
                <div>
                  <p className="text-sm font-bold uppercase tracking-wide text-primary-700">Sesión próxima</p>
                  <p className="text-sm text-gray-500">{nextClass ? `${nextClass.nivel || profile?.nivel || '---'} - ${nextClass.step || '---'}` : '---'}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Fecha</span>
                  <p className="text-sm font-medium text-gray-900">
                    {nextEventDate
                      ? nextEventDate.toLocaleString('es', {
                          weekday: 'short', day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        })
                      : '---'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide">Link de Ingreso</span>
                  {zoomLink ? (
                    <div className="mt-1 flex items-center gap-3">
                      <ZoomAccessButton zoomLink={zoomLink} disponible={showZoom} />
                      {/* El aviso se mantiene visible en los dos estados, pero
                          dice cosas distintas: esperando vs listo para entrar.
                          En verde cuando ya se puede, a juego con el visto del
                          ícono. Los minutos salen de las constantes. */}
                      <p className={`text-sm font-semibold leading-snug ${showZoom ? 'text-emerald-700' : 'text-primary-800'}`}>
                        {showZoom ? MENSAJE_ZOOM_LISTO : MENSAJE_ZOOM_ESPERA}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">---</p>
                  )}
                </div>
                {canVerVideo && (
                  <div className="pt-1">
                    <p className="text-sm text-gray-500 mb-2">Que aprenderás...</p>
                    <button
                      type="button"
                      onClick={handleOpenVideo}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
                    >
                      <VideoCameraIcon className="h-4 w-4" />
                      Ver video
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Derecha: Sesiones + Eventos Programados + Comentarios (apilados) */}
          <div className="space-y-4">
            {/* Sesiones — 4 subtarjetas en línea */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Sesiones</h2>
              <div className="grid grid-cols-4 gap-2">
                <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-center">
                  <div className="text-xl font-bold text-green-700">{statsQuery.isLoading ? '—' : (statsQuery.data?.stats?.asistencias ?? 0)}</div>
                  <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wide leading-tight">Asistidas</div>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-center">
                  <div className="text-xl font-bold text-red-600">{statsQuery.isLoading ? '—' : (statsQuery.data?.stats?.ausencias ?? 0)}</div>
                  <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wide leading-tight">Ausente</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-center">
                  <div className="text-xl font-bold text-amber-600">{statsQuery.isLoading ? '—' : (statsQuery.data?.stats?.canceladas ?? 0)}</div>
                  <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wide leading-tight">Suspendidas</div>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                  <div className="text-xl font-bold text-gray-900">{statsQuery.isLoading ? '—' : (statsQuery.data?.stats?.total ?? 0)}</div>
                  <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-wide leading-tight">Total sesiones</div>
                </div>
              </div>

              {/* Barra de progreso del curso (lecciones) */}
              {profile?.cursoProgreso?.total ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500">Progreso del curso</span>
                    <span className="text-xs font-semibold text-gray-700">
                      {profile.cursoProgreso.actual} / {profile.cursoProgreso.total} lecciones
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.round((profile.cursoProgreso.actual / profile.cursoProgreso.total) * 100))}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {/* Módulos: anterior · actual · próximo */}
              {profile?.cursoModulos ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 text-center">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Módulo anterior</div>
                    <div className="text-xs font-semibold text-gray-700 mt-1 leading-tight">{profile.cursoModulos.anterior}</div>
                  </div>
                  <div className="rounded-lg bg-primary-50 border border-primary-200 p-2 text-center">
                    <div className="text-[10px] text-primary-500 uppercase tracking-wide">Módulo actual</div>
                    <div className="text-xs font-bold text-primary-700 mt-1 leading-tight">{profile.cursoModulos.actual}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 text-center">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">Módulo próximo</div>
                    <div className="text-xs font-semibold text-gray-700 mt-1 leading-tight">{profile.cursoModulos.proximo}</div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Cajas apiladas a ancho completo (cada una con su color): en IMPULSA va
                primero "Lección ##" (cuestionarios de la lección actual, oculta en
                cursos MOSAICO), luego Entrenamientos → Evaluaciones → Nivelación. */}
            {esImpulsa && leccionVisible && (
              <EvaluacionCard tipo="leccion" titulo={leccionTitulo} tono="violet" />
            )}
            <EvaluacionCard tipo="entrenamiento" titulo="Entrenamientos" tono="sky" />
            <EvaluacionCard tipo="evaluacion" titulo="Evaluaciones" tono="rose" />
            {/* Nivelación Programada (ancho completo). Sólo cursos MOSAICO;
                IMPULSA no tiene nivelaciones. Se habilita cuando el admin la aprueba
                y la agenda (booking tipo=NIVELACION). */}
            {!esImpulsa && (
              <NivelacionProgramadaCard
                booking={nivelacionBooking}
                onCancel={handleCancel}
                isCancelling={cancelMutation.isLoading}
              />
            )}

            {/* EVENTOS PROGRAMADOS — eventos de la semana (sesiones, talleres, otros) */}
            <MyEventsSection
              events={weeklyEvents}
              isLoading={eventsQuery.isLoading}
              onCancel={handleCancel}
              isCancelling={cancelMutation.isLoading}
            />

            {/* Comentarios del guía */}
            <AdvisorComments
              data={commentsQuery.data}
              isLoading={commentsQuery.isLoading}
            />
          </div>
        </div>

        {/* Valoración de sesiones (si hay pendientes) */}
        <SinEvaluarCard />

        {/* 5. Let's Go assistance */}
        <WhatsAppContacts />
      </div>

      {/* Instructivos Selection Modal — videos generales para todos los estudiantes */}
      {showInstructivos && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Instructivos</h2>
              <button
                onClick={() => setShowInstructivos(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-500 mb-2">Selecciona un instructivo para ver:</p>
              {instructivosConVideo.map((inst, idx) => {
                const bgColors = ['bg-blue-100','bg-purple-100','bg-green-100','bg-amber-100']
                const iconColors = ['text-blue-600','text-purple-600','text-green-600','text-amber-600']
                const hoverColors = ['hover:bg-blue-50 hover:border-blue-300','hover:bg-purple-50 hover:border-purple-300','hover:bg-green-50 hover:border-green-300','hover:bg-amber-50 hover:border-amber-300']
                const ci = idx % 4
                const src = `/api/postgres/niveles/video?key=${encodeURIComponent(inst.videoKey)}`
                return (
                  <button
                    type="button"
                    key={inst.id}
                    onClick={() => {
                      setShowInstructivos(false)
                      setVideoSrc(src)
                      setVideoTitle(inst.description ? `${inst.title} — ${inst.description}` : inst.title)
                      setVideoOpen(true)
                    }}
                    className={`w-full flex items-center gap-4 p-4 border border-gray-200 rounded-xl ${hoverColors[ci]} transition-colors text-left`}
                  >
                    <div className={`flex-shrink-0 h-12 w-12 ${bgColors[ci]} rounded-lg flex items-center justify-center`}>
                      <VideoCameraIcon className={`h-6 w-6 ${iconColors[ci]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{inst.title}</p>
                      {inst.description && <p className="text-sm text-gray-500">{inst.description}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Video Modal */}
      {videoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-3xl bg-black rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
              <span className="text-white text-sm font-medium">
                {videoTitle || `${profile?.nivel} — ${profile?.effectiveStep || profile?.step}`}
              </span>
              <button
                onClick={() => { setVideoOpen(false); setVideoSrc(null); setVideoTitle(''); setVideoErr(false) }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center">
              {videoErr || !videoSrc ? (
                <div className="text-center p-8">
                  <VideoCameraIcon className="h-12 w-12 text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-300 text-sm font-medium">Video no disponible aún</p>
                  <p className="text-gray-500 text-xs mt-1">El video para este step será publicado próximamente.</p>
                </div>
              ) : (
                <video
                  key={videoSrc}
                  src={videoSrc}
                  controls
                  autoPlay
                  className="w-full h-full"
                  controlsList="nodownload"
                  onError={() => setVideoErr(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showBookingFlow && (
        <BookingFlow
          onClose={() => { setShowBookingFlow(false); setBookingTipo(undefined) }}
          initialTipo={bookingTipo}
        />
      )}

      {/* Soft prompt: si hay evaluaciones pendientes al intentar agendar.
          "Evaluar más tarde y agendar" bypassea — la pendiente queda para evaluar luego. */}
      {softPrompt && pendientesRows.length > 0 && (
        <EvaluacionModal
          item={pendientesRows[0]}
          onClose={handleEvaluarMasTarde}
          onSubmitted={() => {
            // Tras enviar la evaluación, abrimos directo el wizard de booking.
            handleEvaluarMasTarde()
          }}
          laterButtonLabel="Evaluar más tarde y agendar"
        />
      )}

      {showProgress && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Como voy?</h2>
              <button
                onClick={() => setShowProgress(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="p-4">
              <ProgressReport
                data={progressQuery.data}
                isLoading={progressQuery.isLoading}
              />
            </div>
          </div>
        </div>
      )}

      {showMaterials && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Material</h2>
              <button
                onClick={() => setShowMaterials(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="p-4">
              <MaterialsList
                data={materialsQuery.data}
                isLoading={materialsQuery.isLoading}
              />
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-5xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Historial de Clases</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="p-4">
              <ClassHistory
                data={historyQuery.data}
                isLoading={historyQuery.isLoading}
              />
            </div>
          </div>
        </div>
      )}

      {/* Perfil Modal */}
      {showPerfil && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Mi Perfil</h2>
              <button
                onClick={() => setShowPerfil(false)}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-3">
                <div className="h-20 w-20 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center border-2 border-primary-200 flex-shrink-0">
                  {profile?.foto && profile.foto.startsWith('https://')
                    ? <img src={profile.foto} alt="Foto" className="h-full w-full object-cover" />
                    : <span className="text-2xl font-bold text-primary-700">
                        {`${profile?.primerNombre?.[0] || ''}${profile?.primerApellido?.[0] || ''}`.toUpperCase()}
                      </span>
                  }
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold text-gray-900">
                    {[profile?.primerNombre, profile?.segundoNombre, profile?.primerApellido, profile?.segundoApellido].filter(Boolean).join(' ')}
                  </p>
                  {profile?.nivel && (
                    <span className="text-xs font-medium bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">
                      {profile.nivel}{profile.step ? ` - ${profile.step}` : ''}
                    </span>
                  )}
                </div>
              </div>

              <hr className="border-gray-100" />

              {/* Datos */}
              <div className="space-y-3">
                {[
                  { label: 'Número de ID',       value: profile?.numeroId },
                  { label: 'Email',               value: profile?.email },
                  { label: 'Celular',             value: profile?.celular },
                  { label: 'Fecha de nacimiento', value: profile?.fechaNacimiento ? formatDate(profile.fechaNacimiento) : null },
                  { label: 'Domicilio',           value: profile?.domicilio },
                  { label: 'Ciudad',              value: profile?.ciudad },
                  { label: 'Plataforma',          value: profile?.plataforma },
                ].map(({ label, value }) =>
                  value ? (
                    <div key={label} className="flex justify-between items-start gap-4">
                      <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
                      <span className="text-sm font-medium text-gray-900 text-right break-all">{value}</span>
                    </div>
                  ) : null
                )}
              </div>

              {/* Botón Actualizar — solo si perfilActualizado es null */}
              {profile?.perfilActualizado === null && (
                <>
                  <hr className="border-gray-100" />
                  <button
                    type="button"
                    onClick={() => { window.location.href = '/student-setup' }}
                    className="w-full py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Actualizar mis datos
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PanelEstudiantePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" />
            <p className="mt-4 text-gray-600">Cargando...</p>
          </div>
        </div>
      }
    >
      <PanelEstudianteContent />
    </Suspense>
  )
}
