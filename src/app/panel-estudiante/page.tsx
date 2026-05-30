'use client'

import { useState, useMemo, Suspense } from 'react'
import {
  CalendarDaysIcon,
  BookOpenIcon,
  ChartBarIcon,
  VideoCameraIcon,
  XMarkIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { useQuery } from 'react-query'
import {
  useStudentMe,
  useStudentEvents,
  useStudentStats,
  useStudentPanelProgress,
  useStudentMaterials,
  useStudentComments,
  useStudentHistory,
  useCancelBooking,
} from '@/hooks/use-panel-estudiante'

import StudentHeader from '@/components/panel-estudiante/StudentHeader'
import MyEventsSection from '@/components/panel-estudiante/MyEventsSection'
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

function PanelEstudianteContent() {
  const [showBookingFlow, setShowBookingFlow] = useState(false)
  const [bookingTipo, setBookingTipo] = useState<string | undefined>(undefined)
  const [showProgress, setShowProgress] = useState(false)
  const [showMaterials, setShowMaterials] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoTitle, setVideoTitle] = useState<string>('')
  const [videoErr, setVideoErr] = useState(false)
  const [showInstructivos, setShowInstructivos] = useState(false)
  const [showPerfil, setShowPerfil] = useState(false)

  // Instructivos from API
  const instructivosQuery = useQuery(
    'instructivos-config',
    () => fetch('/api/postgres/config/instructivos').then(r => r.json()),
    { staleTime: 10 * 60 * 1000 }
  )
  const instructivosData: { id: number; title: string; description: string; videoKey: string | null }[] =
    instructivosQuery.data?.instructivos ?? [
      { id: 1, title: 'Instructivo 1', description: 'Cómo agendar tus clases',      videoKey: null },
      { id: 2, title: 'Instructivo 2', description: 'Cómo funciona la plataforma', videoKey: null },
    ]

  // Ticker
  const tickerQuery = useQuery(
    'ticker-config',
    () => fetch('/api/postgres/config/ticker').then(r => r.json()),
    { staleTime: 5 * 60 * 1000 }
  )
  const tickerMessage = tickerQuery.data?.message ?? '📢 Usuarios Ecuador 🇪🇨 y Chile 🇨🇱: viernes 3 y sábado 4 de abril no habra sesiones por Semana Santa ✝️. ¡Disfruten su descanso! 🌿✨ | Usuarios Colombia 🇨🇴: sábado 4 de abril habrán sesiones normales 👍'
  const tickerColor = tickerQuery.data?.color ?? '#ffffff'

  // Queries
  const meQuery = useStudentMe()
  const eventsQuery = useStudentEvents()
  const statsQuery = useStudentStats()
  const progressQuery = useStudentPanelProgress()
  const materialsQuery = useStudentMaterials()
  const commentsQuery = useStudentComments()
  const historyQuery = useStudentHistory()

  // Mutations
  const cancelMutation = useCancelBooking()

  const profile = meQuery.data?.profile
  const events = eventsQuery.data?.events || []

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

  // Hard block: si hay evaluaciones pendientes (asistidas + sin evaluar),
  // bloqueamos la apertura del wizard de agendamiento y forzamos a evaluar.
  // El servidor también valida (defense in depth).
  const evalPendientesQuery = useEvaluacionesPendientes()
  const pendientesRows = evalPendientesQuery.data?.featureEnabled ? (evalPendientesQuery.data.rows ?? []) : []
  const [showHardBlock, setShowHardBlock] = useState(false)

  const openBooking = (tipo?: string) => {
    if (pendientesRows.length > 0) {
      setShowHardBlock(true)
      return
    }
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
  const now = new Date()
  const showZoom = nextClass && nextEventDate
    ? (nextEventDate.getTime() - now.getTime()) / (1000 * 60) <= 5
      && (now.getTime() - nextEventDate.getTime()) / (1000 * 60) <= 10
    : false
  const zoomLink = nextClass?.eventLinkZoom || nextClass?.linkZoom

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 1. Top Bar: WhatsApp + Greeting + Nivel */}
      <StudentHeader profile={profile} isLoading={meQuery.isLoading} />

      {/* 2. Booking Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="mx-auto px-2 flex flex-wrap items-center gap-3">
          <span className="text-lg font-bold text-primary-700 mr-2">LGS</span>
          <span className="text-sm text-gray-500 mr-1">Booking:</span>
          <button
            onClick={() => openBooking('SESSION')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5"
          >
            <CalendarDaysIcon className="h-4 w-4" />
            Session
          </button>
          <button
            onClick={() => openBooking('CLUB')}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center gap-1.5"
          >
            <CalendarDaysIcon className="h-4 w-4" />
            Clubs
          </button>

          <div className="flex-1" />

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
          <button
            onClick={() => setShowInstructivos(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <VideoCameraIcon className="h-4 w-4" />
            Instructivos
          </button>
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
        <div className="flex-shrink-0 bg-blue-600 flex items-center px-4 py-2 gap-2">
          <span className="text-white text-xs font-black uppercase tracking-widest">📢 LGS</span>
        </div>
        <div className="flex-1 overflow-hidden flex items-center py-2">
          <span className="lgs-ticker-text text-sm font-medium px-8" style={{ color: tickerColor }}>
            {tickerMessage}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 pt-8 pb-6 space-y-6">
        {/* Performance Evaluation — tarjeta "Sin Evaluar" (solo si flag activo + hay pendientes) */}
        <SinEvaluarCard />

        {/* Jump exam banner (only when eligible) */}
        <JumpExamBanner />

        {/* 3. Student Info Card + Attendance Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Student Info Card */}
          <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-xl p-5 text-white">
            {meQuery.isLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-white/20 rounded w-24" />
                <div className="h-4 bg-white/20 rounded w-32" />
                <div className="h-4 bg-white/20 rounded w-28" />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-lg font-bold uppercase tracking-wide">Next Session</p>
                  <p className="text-sm font-medium text-primary-200">{nextClass ? `${nextClass.nivel || profile?.nivel || '---'} - ${nextClass.step || '---'}` : '---'}</p>
                </div>
                <div>
                  <span className="text-xs text-primary-200 uppercase tracking-wide">Asesor</span>
                  <p className="text-sm font-medium">
                    {nextClass?.advisorNombre || '---'}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-primary-200 uppercase tracking-wide">Fecha</span>
                  <p className="text-sm font-medium">
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
                  <span className="text-xs text-primary-200 uppercase tracking-wide">Link de Ingreso</span>
                  {showZoom && zoomLink ? (
                    <a
                      href={zoomLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/20 text-white text-sm font-medium rounded-lg hover:bg-white/30 transition-colors"
                    >
                      <VideoCameraIcon className="h-4 w-4" />
                      Entrar a Zoom
                    </a>
                  ) : (
                    <p className="text-sm text-white">
                      {zoomLink ? 'Enlace disponible 5 min antes, recuerda refrescar el navegador' : '---'}
                    </p>
                  )}
                </div>
                <div className="pt-2 border-t border-white/20">
                  <p className="text-sm text-primary-200 mb-2">Que aprenderas...</p>
                  <button
                    onClick={handleOpenVideo}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/20 text-white text-sm font-medium rounded-lg hover:bg-white/30 transition-colors"
                  >
                    <VideoCameraIcon className="h-4 w-4" />
                    Ver video
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Stats Cards + Events stacked */}
          <div className="lg:col-span-2 space-y-4">
            <AttendanceStats
              stats={statsQuery.data?.stats}
              isLoading={statsQuery.isLoading}
            />
            <MyEventsSection
              events={events}
              isLoading={eventsQuery.isLoading}
              onCancel={handleCancel}
              isCancelling={cancelMutation.isLoading}
            />
          </div>
        </div>

        {/* 5. Advisor Comments (full width) */}
        <AdvisorComments
          data={commentsQuery.data}
          isLoading={commentsQuery.isLoading}
        />

        {/* 5. Let's Go assistance */}
        <WhatsAppContacts />
      </div>

      {/* Instructivos Selection Modal */}
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
              {instructivosData.map((inst, idx) => {
                const bgColors = ['bg-blue-100','bg-purple-100','bg-green-100','bg-amber-100']
                const iconColors = ['text-blue-600','text-purple-600','text-green-600','text-amber-600']
                const hoverColors = ['hover:bg-blue-50 hover:border-blue-300','hover:bg-purple-50 hover:border-purple-300','hover:bg-green-50 hover:border-green-300','hover:bg-amber-50 hover:border-amber-300']
                const ci = idx % 4
                const src = inst.videoKey
                  ? `/api/postgres/niveles/video?key=${encodeURIComponent(inst.videoKey)}`
                  : `/instructivo${inst.id}.mp4`  // fallback to static file
                return (
                  <button
                    type="button"
                    key={inst.id}
                    onClick={() => {
                      setShowInstructivos(false)
                      setVideoSrc(src)
                      setVideoTitle(`${inst.title} — ${inst.description}`)
                      setVideoOpen(true)
                    }}
                    className={`w-full flex items-center gap-4 p-4 border border-gray-200 rounded-xl ${hoverColors[ci]} transition-colors text-left`}
                  >
                    <div className={`flex-shrink-0 h-12 w-12 ${bgColors[ci]} rounded-lg flex items-center justify-center`}>
                      <VideoCameraIcon className={`h-6 w-6 ${iconColors[ci]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{inst.title}</p>
                      <p className="text-sm text-gray-500">{inst.description}</p>
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

      {/* Hard block: si hay evaluaciones pendientes al intentar agendar */}
      {showHardBlock && pendientesRows.length > 0 && (
        <EvaluacionModal
          items={pendientesRows}
          onClose={() => setShowHardBlock(false)}
          onAllDone={() => { setShowHardBlock(false); /* el usuario re-clickea Booking */ }}
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
                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
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
