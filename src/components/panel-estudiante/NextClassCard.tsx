'use client'

import { useMemo, useState } from 'react'
import {
  VideoCameraIcon,
  ClockIcon,
  UserIcon,
  XMarkIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline'
import { ZOOM_ABRE_MIN_ANTES, zoomDisponible } from '@/lib/zoom-window'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface NextClassCardProps {
  events: any[]
  isLoading: boolean
}

export default function NextClassCard({ events, isLoading }: NextClassCardProps) {
  const [videoOpen, setVideoOpen] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)

  const nextClass = useMemo(() => {
    if (!events || events.length === 0) return null
    return events[0]
  }, [events])

  async function handleOpenVideo() {
    if (!nextClass) return
    setVideoLoading(true)
    setVideoOpen(true)
    try {
      const res = await fetch(
        `/api/postgres/niveles/video?nivel=${encodeURIComponent(nextClass.nivel)}&step=${encodeURIComponent(nextClass.step)}`
      )
      const data = await res.json()
      setVideoUrl(data?.data?.videoUrl ?? null)
    } catch {
      setVideoUrl(null)
    } finally {
      setVideoLoading(false)
    }
  }

  function handleCloseVideo() {
    setVideoOpen(false)
    setVideoUrl(null)
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-32 mb-3" />
        <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-40" />
      </div>
    )
  }

  if (!nextClass) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Proxima Clase
        </h3>
        <p className="text-gray-400 text-sm">No tienes clases programadas</p>
      </div>
    )
  }

  const eventDate = new Date(nextClass.fechaEvento)
  // Misma ventana que el panel (lib/zoom-window). Antes tenía la suya propia
  // (5 antes / 10 después) y ya se había despegado de la del panel.
  const showZoom = zoomDisponible(eventDate.getTime())
  const zoomLink = nextClass.eventLinkZoom || nextClass.linkZoom

  const tipoColor = nextClass.tipo === 'SESSION'
    ? 'bg-blue-100 text-blue-800'
    : nextClass.tipo === 'CLUB'
    ? 'bg-green-100 text-green-800'
    : 'bg-purple-100 text-purple-800'

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Proxima Clase
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipoColor}`}>
              {nextClass.tipo || nextClass.tipoEvento}
            </span>
            <span className="text-sm text-gray-600">
              {nextClass.nivel} - {nextClass.step}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <ClockIcon className="h-4 w-4 text-gray-400" />
            <span className="font-medium">
              {format(eventDate, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
            </span>
          </div>
          {nextClass.advisorNombre && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <UserIcon className="h-4 w-4 text-gray-400" />
              <span>{nextClass.advisorNombre}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {showZoom && zoomLink ? (
              <a
                href={zoomLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                title="Entrar a Zoom"
              >
                <VideoCameraIcon className="h-5 w-5" />
                Entrar a Zoom
              </a>
            ) : zoomLink ? (
              <span className="inline-flex items-center gap-2 text-sm text-white font-medium">
                <VideoCameraIcon className="h-4 w-4 text-white" />
                Enlace disponible {ZOOM_ABRE_MIN_ANTES} min antes, recuerda refrescar el navegador
              </span>
            ) : null}
            <button
              onClick={handleOpenVideo}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-200"
            >
              <PlayCircleIcon className="h-4 w-4" />
              Ver Video
            </button>
          </div>
        </div>
      </div>

      {/* Video Modal */}
      {videoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-3xl bg-black rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
              <span className="text-white text-sm font-medium">
                {nextClass.nivel} — {nextClass.step}
              </span>
              <button
                onClick={handleCloseVideo}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center">
              {videoLoading ? (
                <div className="text-gray-400 text-sm">Cargando video...</div>
              ) : videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full"
                  controlsList="nodownload"
                />
              ) : (
                <div className="text-gray-400 text-sm">
                  No hay video disponible para esta clase.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
