'use client'

/**
 * /panel-estudiante/material-interactivo/[nivel]
 *
 * Visor de libro interactivo para el estudiante.
 *
 *  - Carga la metadata del nivel (total páginas + páginas con audio).
 *  - Renderiza la página actual usando presigned URL (10 min TTL).
 *  - Navegación: flechas ← →, swipe táctil, teclado.
 *  - Reproductor de audio inline cuando la página tiene audio.
 *  - Pre-fetch de las imágenes vecinas (n-1, n+1) para navegación instantánea.
 *
 * Reemplaza al link externo a Wix (`lgsplataforma.com/material-{nivel}`).
 * El botón "Material Interactivo (clásico)" sigue disponible mientras dure la
 * coexistencia controlada por feature flag.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SpeakerWaveIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

interface AudioInfo {
  idx: number
  titulo: string | null
}

interface Metadata {
  available: boolean
  libroCodigo?: string
  libroTitulo?: string
  totalPaginas?: number
  paginasConAudio?: number[]
  /** Mapa pagina-local → lista de audios (nuevo, multi-audio). */
  audiosPorPagina?: Record<number, AudioInfo[]>
}

interface AudioPlayable {
  idx: number
  titulo: string | null
  url: string
}

export default function MaterialInteractivoPage() {
  const router = useRouter()
  const params = useParams<{ nivel: string }>()
  const nivel = (params?.nivel || '').toString().toUpperCase()

  // Modo preview: solo SUPER_ADMIN/ADMIN puede usarlo (el server valida).
  // Cuando preview=1 + admin → bypass del feature flag global.
  const isPreview = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === '1'
  // Módulo actual del alumno: recorta el libro a las páginas de ESE módulo.
  const modulo = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('modulo') || '')
    : ''
  // QS para metadata (incluye preview + modulo) y sufijo para page/audio (que ya llevan ?n=).
  const metaParams = [isPreview ? 'preview=1' : '', modulo ? `modulo=${encodeURIComponent(modulo)}` : ''].filter(Boolean)
  const previewQsFirst = metaParams.length ? `?${metaParams.join('&')}` : ''
  const moduloSuffix = modulo ? `&modulo=${encodeURIComponent(modulo)}` : ''

  const [meta, setMeta] = useState<Metadata | null>(null)
  const [page, setPage] = useState(1)
  const [imageCache, setImageCache] = useState<Record<number, string>>({})
  const [audios, setAudios] = useState<AudioPlayable[]>([])
  const [error, setError] = useState<string | null>(null)
  const touchStartX = useRef<number | null>(null)

  // 1) Carga metadata — con reintento si BD esta saturada (500 esporadico)
  useEffect(() => {
    let cancelled = false
    setError(null)

    const load = async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`/api/postgres/libros-interactivos/${encodeURIComponent(nivel)}${previewQsFirst}`, { cache: 'no-store' })
          if (r.status === 500 && i < 2) {
            await new Promise(res => setTimeout(res, 1500 * (i + 1)))
            continue
          }
          const json: Metadata = await r.json()
          if (cancelled) return
          if (!json?.available) {
            setMeta({ available: false })
          } else {
            setMeta(json)
          }
          return
        } catch (e) {
          if (i === 2) {
            if (!cancelled) setError('No se pudo cargar el material')
            return
          }
          await new Promise(res => setTimeout(res, 1500 * (i + 1)))
        }
      }
    }
    load()

    return () => { cancelled = true }
  }, [nivel, previewQsFirst])

  const total = meta?.totalPaginas ?? 0
  // Conteo de audios por página (lo usamos para decidir si fetch o no).
  const audiosPorPagina = meta?.audiosPorPagina || {}
  const cantidadAudiosPagina = useMemo(
    () => audiosPorPagina[page]?.length || 0,
    [audiosPorPagina, page]
  )

  // 2) Carga URL de la página actual + pre-cache vecinas
  useEffect(() => {
    if (!meta?.available || !total) return
    const targetPages = [page, page - 1, page + 1].filter(p => p >= 1 && p <= total)
    let cancelled = false

    ;(async () => {
      for (const p of targetPages) {
        if (imageCache[p]) continue
        try {
          const r = await fetch(`/api/postgres/libros-interactivos/${encodeURIComponent(nivel)}/page?n=${p}${moduloSuffix}`)
          const j = await r.json()
          if (cancelled) return
          if (j?.success && j.url) {
            setImageCache(prev => ({ ...prev, [p]: j.url }))
          }
        } catch { /* silent */ }
      }
    })()

    return () => { cancelled = true }
  }, [page, total, meta?.available, nivel, imageCache])

  // 3) Carga TODOS los audios de la página actual (puede haber varios)
  useEffect(() => {
    if (!meta?.available || !total || cantidadAudiosPagina === 0) {
      setAudios([])
      return
    }
    let cancelled = false
    fetch(`/api/postgres/libros-interactivos/${encodeURIComponent(nivel)}/audio?n=${page}${moduloSuffix}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (j?.available && Array.isArray(j.audios)) setAudios(j.audios)
        else setAudios([])
      })
      .catch(() => { if (!cancelled) setAudios([]) })
    return () => { cancelled = true }
  }, [page, cantidadAudiosPagina, meta?.available, total, nivel])

  // 4) Teclado: ← → para navegar, Esc para volver
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  setPage(p => Math.max(1, p - 1))
      if (e.key === 'ArrowRight') setPage(p => Math.min(total, p + 1))
      if (e.key === 'Escape')     router.push('/panel-estudiante')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [total, router])

  // 5) Swipe táctil
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 50) return
    if (dx > 0)      setPage(p => Math.max(1, p - 1))
    else             setPage(p => Math.min(total, p + 1))
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">No se pudo cargar el material</h2>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <button type="button" onClick={() => router.push('/panel-estudiante')} className="text-sm text-indigo-600 hover:underline">
            ← Volver al panel
          </button>
        </div>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-500">Cargando libro…</div>
      </div>
    )
  }

  if (!meta.available) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            Material interactivo no disponible
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Tu curso aún no tiene un libro interactivo cargado. Avisa al equipo académico.
          </p>
          <button type="button" onClick={() => router.push('/panel-estudiante')} className="text-sm text-indigo-600 hover:underline">
            ← Volver al panel
          </button>
        </div>
      </div>
    )
  }

  const currentUrl = imageCache[page]
  const canPrev = page > 1
  const canNext = page < (total || 0)

  return (
    <div
      className="min-h-screen bg-gray-100 flex flex-col"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
        <button
          type="button"
          onClick={() => router.push('/panel-estudiante')}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Volver
        </button>
        <div className="text-sm">
          <span className="font-semibold text-gray-800">{meta.libroTitulo}</span>
          <span className="text-gray-500 ml-2">— {nivel}</span>
        </div>
        <div className="text-xs text-gray-500 tabular-nums">
          Página <span className="font-bold text-gray-800">{page}</span> / {total}
        </div>
      </div>

      {/* Visor */}
      <div className="flex-1 flex items-center justify-center px-2 sm:px-6 py-4 select-none">
        <button
          type="button"
          onClick={() => canPrev && setPage(p => p - 1)}
          disabled={!canPrev}
          className="flex-shrink-0 mr-2 sm:mr-4 w-10 sm:w-12 h-12 sm:h-12 rounded-full bg-indigo-600 text-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors flex items-center justify-center"
          aria-label="Página anterior"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>

        <div className="flex-1 max-w-5xl bg-white rounded-lg shadow-xl overflow-hidden flex items-center justify-center" style={{ minHeight: 400 }}>
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt={`Página ${page}`}
              className="max-h-[78vh] max-w-full w-auto object-contain"
              draggable={false}
            />
          ) : (
            <div className="text-sm text-gray-400">Cargando página…</div>
          )}
        </div>

        <button
          type="button"
          onClick={() => canNext && setPage(p => p + 1)}
          disabled={!canNext}
          className="flex-shrink-0 ml-2 sm:ml-4 w-10 sm:w-12 h-12 sm:h-12 rounded-full bg-indigo-600 text-white shadow-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors flex items-center justify-center"
          aria-label="Página siguiente"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      </div>

      {/* Audios + barra de progreso. La pagina puede tener 0..N audios. */}
      <div className="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-3">
        {audios.length > 0 ? (
          <div className="flex-1 flex flex-col gap-1.5 max-h-32 overflow-y-auto">
            {audios.map((a) => (
              <div key={a.url} className="flex items-center gap-2">
                <SpeakerWaveIcon className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-700 w-32 truncate flex-shrink-0" title={a.titulo || `Audio ${a.idx + 1}`}>
                  {a.titulo || `Audio ${a.idx + 1}`}
                </span>
                <audio
                  src={a.url}
                  controls
                  autoPlay={false}
                  preload="metadata"
                  className="flex-1 max-w-md h-8"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 text-xs text-gray-400">Esta página no tiene audio</div>
        )}
        <div className="w-32 sm:w-48 bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-indigo-600 h-full transition-all"
            style={{ width: `${(page / (total || 1)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
