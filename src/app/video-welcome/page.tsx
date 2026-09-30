'use client'

import { useEffect, useState } from 'react'

/**
 * /video-welcome — PÚBLICA. Es el enlace que recibe por WhatsApp quien faltó a
 * sus dos sesiones de bienvenida. Muestra siempre el video VIGENTE (se puede
 * reemplazar desde Servicio › Welcome Session › Video Welcome sin reenviar nada).
 */
export default function VideoWelcomePage() {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/public/video-welcome', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => (j?.success && j.url ? setUrl(j.url) : setError(j?.error || 'Aún no hay video disponible.')))
      .catch(() => setError('No se pudo cargar el video. Intenta de nuevo en unos minutos.'))
  }, [])

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-fuchsia-50 to-purple-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="MOSAICO" className="h-12 w-12" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-fuchsia-700">MOSAICO</p>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary-900 text-balance">Bienvenida a la plataforma</h1>
          </div>
        </div>

        <div className="rounded-2xl bg-white shadow-xl overflow-hidden">
          <div className="aspect-video bg-gray-900 flex items-center justify-center">
            {url ? (
              <video src={url} controls playsInline preload="metadata" className="w-full h-full" />
            ) : (
              <p className="text-sm text-gray-300 px-6 text-center">{error || 'Cargando video…'}</p>
            )}
          </div>
          <div className="p-5 sm:p-6">
            <p className="text-gray-700 leading-relaxed">
              En este video te explicamos cómo ingresar a la plataforma y dar tus primeros pasos en MOSAICO.
            </p>
            <p className="mt-3 text-sm text-gray-500">
              Si tienes dudas, respóndenos por el mismo WhatsApp por el que recibiste este enlace.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
