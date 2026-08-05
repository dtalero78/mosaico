'use client'

import { useState, useEffect } from 'react'
import { BookOpenIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { isDriveUrl, driveEmbedUrl } from '@/lib/drive-embed'

interface Material {
  index: number
  name: string
  url: string
  key?: string   // DO Spaces key — present when file lives in Spaces
}

interface Props {
  /** Step name, e.g. "Step 3" */
  step: string
  /** Nivel code, e.g. "BN1" */
  nivel: string
}

/** Returns true for Office files that can be previewed via MS Office Online */
function isOfficeFile(name: string) {
  return /\.(pptx?|docx?|xlsx?)$/i.test(name)
}

export default function SessionAdvisorMaterialTab({ step, nivel }: Props) {
  const [materials, setMaterials]     = useState<Material[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Viewer modal state
  const [viewerUrl, setViewerUrl]     = useState<string | null>(null)
  const [viewerTitle, setViewerTitle] = useState('')
  const [viewerLoading, setViewerLoading] = useState(false)

  useEffect(() => { loadMaterials() }, [step, nivel])

  const loadMaterials = async () => {
    if (!step) return
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({ step, tipo: 'advisor' })
      if (nivel) params.set('nivel', nivel)
      const r = await fetch(`/api/postgres/materials/nivel?${params}`)
      if (!r.ok) throw new Error('Error al cargar material')
      const data = await r.json()
      if (data.success) setMaterials(data.materials || [])
      else throw new Error(data.error || 'Error al cargar material')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  /** Returns true if the URL is a valid HTTP/HTTPS link the browser can open */
  const isValidHttpUrl = (url: string) =>
    url.startsWith('http://') || url.startsWith('https://')

  const handleDownload = async (mat: Material) => {
    // DO Spaces key → generate presigned URL for download
    if (mat.key) {
      try {
        const r = await fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(mat.key)}`)
        const d = await r.json()
        if (d.success && d.signedUrl) {
          window.open(d.signedUrl, '_blank', 'noopener,noreferrer')
          return
        }
      } catch { /* fall through */ }
      alert('No se pudo generar el enlace de descarga')
      return
    }
    // Regular HTTP URL
    if (isValidHttpUrl(mat.url)) {
      window.open(mat.url, '_blank', 'noopener,noreferrer')
      return
    }
    alert('Este archivo fue migrado de Wix y no está disponible para descarga. Debe ser reemplazado desde el panel de administración.')
  }

  const handleVisualize = async (mat: Material) => {
    // Enlace de Google Drive → incrustar la vista previa /preview (sin presigned)
    if (isDriveUrl(mat.url)) {
      setViewerTitle(mat.name)
      setViewerLoading(false)
      setViewerUrl(driveEmbedUrl(mat.url) || mat.url)
      return
    }
    if (!mat.key) return
    setViewerTitle(mat.name)
    setViewerLoading(true)
    setViewerUrl(null)
    try {
      const r = await fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(mat.key)}`)
      const d = await r.json()
      if (!d.success || !d.signedUrl) throw new Error(d.error || 'No se pudo obtener enlace')
      const officeViewer = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(d.signedUrl)}`
      setViewerUrl(officeViewer)
    } catch (e: any) {
      alert(`Error al generar vista previa: ${e.message}`)
    } finally {
      setViewerLoading(false)
    }
  }

  const label = nivel && step ? `${nivel} — ${step}` : step || '…'

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
          <span className="ml-3 text-amber-700">Cargando material...</span>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <BookOpenIcon className="h-12 w-12 text-red-400 mx-auto mb-3" />
        <p className="text-red-600">Error al cargar material: {error}</p>
        <button
          onClick={loadMaterials}
          className="mt-4 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
        >
          Reintentar
        </button>
      </div>
    )
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (materials.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <BookOpenIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-600">No hay material de advisor disponible para este step</p>
        <p className="text-sm text-gray-500 mt-2">{label}</p>
      </div>
    )
  }

  // ── Content ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-amber-600 px-6 py-4">
          <div className="flex items-center gap-3">
            <BookOpenIcon className="h-6 w-6 text-white" />
            <h3 className="text-lg font-bold text-white">Material del Advisor — {label}</h3>
            <span className="ml-auto px-3 py-1 bg-white text-amber-600 rounded-full text-sm font-semibold">
              {materials.length} {materials.length === 1 ? 'archivo' : 'archivos'}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-amber-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-amber-900 uppercase tracking-wider w-10">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-amber-900 uppercase tracking-wider">Nombre del Archivo</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-amber-900 uppercase tracking-wider">Acción</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {materials.map(mat => {
                const drive = isDriveUrl(mat.url)
                const office = (isOfficeFile(mat.name) && !!mat.key) || drive
                const available = !!mat.key || isValidHttpUrl(mat.url)
                // Enlace externo (p. ej. actividad WordWall): abrir en pestaña nueva, no "descargar"
                const plainLink = !mat.key && !drive && isValidHttpUrl(mat.url)
                return (
                  <tr key={mat.index} className="hover:bg-amber-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{mat.index}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="font-medium">{mat.name}</span>
                        {!available && (
                          <span className="ml-1 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                            Archivo legacy — reemplazar
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        {/* Visualizar — solo para Office files con key en Spaces */}
                        {office && (
                          <button
                            type="button"
                            onClick={() => handleVisualize(mat)}
                            disabled={viewerLoading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {viewerLoading && viewerTitle === mat.name
                              ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              : <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            }
                            Visualizar
                          </button>
                        )}
                        {/* Descargar — solo si el archivo está disponible */}
                        {available ? (
                          <button
                            type="button"
                            onClick={() => handleDownload(mat)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {plainLink ? 'Abrir' : 'Descargar'}
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 text-xs text-gray-400 bg-gray-100 rounded-lg">
                            No disponible
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-amber-50 px-6 py-3 flex items-center gap-2 text-xs text-amber-700 border-t border-amber-200">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Los archivos PPTX, DOCX, XLSX y los <strong>enlaces de Google Drive</strong> tienen botón <strong>Visualizar</strong> para ver en pantalla</span>
        </div>
      </div>

      {/* Office Online Viewer Modal */}
      {(viewerUrl || viewerLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-5xl h-[85vh] bg-white rounded-xl overflow-hidden shadow-2xl flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 flex-shrink-0">
              <span className="text-white text-sm font-medium truncate pr-4">{viewerTitle}</span>
              <button
                type="button"
                title="Cerrar"
                onClick={() => { setViewerUrl(null); setViewerTitle('') }}
                className="text-gray-400 hover:text-white flex-shrink-0"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            {/* Viewer */}
            <div className="flex-1 bg-gray-100 flex items-center justify-center">
              {viewerLoading ? (
                <div className="text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">Preparando vista previa...</p>
                </div>
              ) : viewerUrl ? (
                <iframe
                  src={viewerUrl}
                  className="w-full h-full border-0"
                  title={viewerTitle}
                  allow="fullscreen"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
