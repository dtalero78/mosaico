'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ArrowLeftIcon, AcademicCapIcon, ArrowUpTrayIcon, TrashIcon,
  PlayIcon, XMarkIcon, VideoCameraIcon, ArrowDownTrayIcon, ShieldCheckIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface StepRow {
  _id: string
  code: string
  step: string
  description?: string
  videoUrl: string | null   // DO Spaces key
}

type UploadingKey = string   // "{nivel}|{step}"

const NIVELES_CODES = [
  'WELCOME','BN1','BN2','BN3','P1','P2','P3','F1','F2','F3','F4','DONE','ESS'
]

export default function ActualizarVideosSesionesPage() {
  const [nivel, setNivel]             = useState('BN1')
  const [steps, setSteps]             = useState<StepRow[]>([])
  const [loading, setLoading]         = useState(false)
  const [uploading, setUploading]     = useState<UploadingKey | null>(null)
  const [previewSrc, setPreviewSrc]   = useState<string | null>(null)
  const [previewStep, setPreviewStep] = useState<string>('')
  const [previewErr, setPreviewErr]   = useState(false)
  const [confirmDel, setConfirmDel]   = useState<{ nivel: string; step: string } | null>(null)
  const [checking, setChecking]       = useState(false)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // ── Check & clean stale videoUrls ──────────────────────────────────────────
  const handleCheckSpaces = async () => {
    if (!confirm('Verificará todos los videoUrl en NIVELES contra DO Spaces y limpiará los que no existan. ¿Continuar?')) return
    setChecking(true)
    try {
      const r = await fetch('/api/admin/videos/check-niveles', { method: 'POST' })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      const cleared = d.results.filter((r: any) => r.cleared).length
      const ok      = d.results.filter((r: any) => r.exists).length
      toast.success(`Verificados: ${d.checked} | Válidos: ${ok} | Limpiados: ${cleared}`)
      await loadSteps(nivel)
    } catch (e: any) { toast.error(e.message || 'Error al verificar') }
    finally { setChecking(false) }
  }

  useEffect(() => { loadSteps(nivel) }, [nivel])

  const loadSteps = async (code: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/videos/sesiones?nivel=${encodeURIComponent(code)}`)
      const d = await r.json()
      if (d.success) setSteps(d.steps || [])
    } catch { toast.error('Error al cargar steps') }
    finally { setLoading(false) }
  }

  // ── Upload MP4 ──────────────────────────────────────────────────────────────
  const handleUpload = async (nivelCode: string, step: string, file: File) => {
    if (!file.type.startsWith('video/')) { toast.error('Solo archivos de video'); return }
    const uploadKey = `${nivelCode}|${step}`
    setUploading(uploadKey)
    try {
      // Step 1 — get presigned PUT URL from server
      const presignRes = await fetch('/api/admin/videos/sesiones/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nivel: nivelCode, step, contentType: file.type || 'video/mp4' }),
      })
      const presignData = await presignRes.json()
      if (!presignData.success) throw new Error(presignData.error || 'Error al generar URL')

      // Step 2 — upload directly to DO Spaces (no server timeout)
      const uploadRes = await fetch(presignData.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'video/mp4' },
        body: file,
      })
      if (!uploadRes.ok) throw new Error(`Error al subir a Spaces: ${uploadRes.status}`)

      // Step 3 — confirm upload, update NIVELES.videoUrl
      const confirmRes = await fetch('/api/admin/videos/sesiones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nivel: nivelCode, step, key: presignData.key }),
      })
      const confirmData = await confirmRes.json()
      if (!confirmData.success) throw new Error(confirmData.error || 'Error al confirmar')

      toast.success('Video subido correctamente')
      await loadSteps(nivelCode)
    } catch (e: any) { toast.error(e.message || 'Error al subir') }
    finally { setUploading(null) }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!confirmDel) return
    const { nivel: n, step: s } = confirmDel
    try {
      const params = new URLSearchParams({ nivel: n, step: s, field: 'videoUrl' })
      const r = await fetch(`/api/admin/videos/sesiones?${params}`, { method: 'DELETE' })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Video eliminado')
      setConfirmDel(null)
      await loadSteps(n)
    } catch (e: any) { toast.error(e.message || 'Error al eliminar') }
  }

  // ── Preview ─────────────────────────────────────────────────────────────────
  const openPreview = (row: StepRow) => {
    setPreviewErr(false)
    setPreviewStep(row.step)
    setPreviewSrc(`/api/postgres/niveles/video?nivel=${encodeURIComponent(row.code)}&step=${encodeURIComponent(row.step)}`)
  }

  const closePreview = () => { setPreviewSrc(null); setPreviewErr(false); setPreviewStep('') }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button type="button" onClick={() => window.close()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Cerrar
          </button>
          <AcademicCapIcon className="h-6 w-6 text-purple-600" />
          <h1 className="text-xl font-bold text-gray-900">Videos — Sesiones</h1>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={handleCheckSpaces}
              disabled={checking}
              title="Verifica videoUrl contra Spaces y limpia los que no existen"
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {checking
                ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Verificando...</>
                : <><ShieldCheckIcon className="h-4 w-4" /> Verificar Spaces</>
              }
            </button>
            <label className="text-sm text-gray-500">Nivel:</label>
            <select
              value={nivel}
              onChange={e => setNivel(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {NIVELES_CODES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600" />
          </div>
        ) : steps.length === 0 ? (
          <div className="text-center py-16 text-gray-500">No se encontraron steps para {nivel}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-200">
              <thead className="bg-purple-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase tracking-wider w-40">Step</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase tracking-wider">Video MP4</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-purple-900 uppercase tracking-wider w-48">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {steps.map(row => {
                  const uploadKey = `${row.code}|${row.step}`
                  const isUploadingThis = uploading === uploadKey
                  return (
                    <tr key={row._id} className="hover:bg-purple-50 transition-colors">
                      {/* Step */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-medium text-gray-900 text-sm">{row.step}</span>
                      </td>

                      {/* Video MP4 */}
                      <td className="px-6 py-4">
                        <input
                          ref={el => { fileInputRefs.current[uploadKey] = el }}
                          type="file" accept="video/*" className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) handleUpload(row.code, row.step, file)
                            e.target.value = ''
                          }}
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          {row.videoUrl
                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">✓ Cargado</span>
                            : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">Sin video</span>
                          }
                          <button
                            type="button"
                            onClick={() => fileInputRefs.current[uploadKey]?.click()}
                            disabled={isUploadingThis}
                            className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                          >
                            {isUploadingThis
                              ? <><div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Subiendo</>
                              : <><ArrowUpTrayIcon className="h-3 w-3" /> {row.videoUrl ? 'Reemplazar' : 'Subir'}</>
                            }
                          </button>
                          {row.videoUrl && (
                            <button
                              type="button"
                              onClick={() => setConfirmDel({ nivel: row.code, step: row.step })}
                              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Eliminar video"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Acciones */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {row.videoUrl && (
                            <button
                              type="button"
                              onClick={() => openPreview(row)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              <PlayIcon className="h-3.5 w-3.5" /> Ver
                            </button>
                          )}
                          {row.videoUrl && (
                            <a
                              href={`/api/postgres/niveles/video?nivel=${encodeURIComponent(row.code)}&step=${encodeURIComponent(row.step)}&download=1`}
                              download
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors"
                            >
                              <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Descargar
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Delete Modal */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar eliminación</h3>
            <p className="text-sm text-gray-600 mb-4">
              ¿Eliminar el video de <strong>{confirmDel.step}</strong>? El archivo también será borrado de DO Spaces.
            </p>
            <div className="flex gap-3">
              <button type="button"
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
              >
                Eliminar
              </button>
              <button type="button"
                onClick={() => setConfirmDel(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-3xl bg-black rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
              <span className="text-white text-sm font-medium">Vista previa — {nivel} · {previewStep}</span>
              <button type="button" title="Cerrar" onClick={closePreview} className="text-gray-400 hover:text-white">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center">
              {previewErr ? (
                <div className="text-center p-8">
                  <VideoCameraIcon className="h-12 w-12 text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">El archivo de video no está disponible en el almacenamiento.</p>
                  <p className="text-gray-500 text-xs mt-1">Usa el botón <strong>Reemplazar</strong> para subir el archivo MP4.</p>
                  <button type="button" onClick={closePreview}
                    className="mt-4 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-600">
                    Cerrar
                  </button>
                </div>
              ) : (
                <video
                  key={previewSrc}
                  src={previewSrc}
                  controls autoPlay
                  className="w-full h-full"
                  onError={() => setPreviewErr(true)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
