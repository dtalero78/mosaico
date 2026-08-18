'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ArrowLeftIcon, VideoCameraIcon, PencilIcon, TrashIcon,
  ArrowUpTrayIcon, PlayIcon, XMarkIcon, CheckIcon, PlusIcon, ArrowDownTrayIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Instructivo {
  id: number
  title: string
  description: string
  videoKey: string | null
}

interface EditState { title: string; description: string }

export default function ActualizarVideosInstructivosPage() {
  const [instructivos, setInstructivos] = useState<Instructivo[]>([])
  const [loading, setLoading]           = useState(true)
  const [uploading, setUploading]       = useState<number | null>(null)
  // Instructivo recién creado: se resalta para que se vea DÓNDE se sube el video,
  // que es el paso siguiente y no está en el formulario de alta.
  const [recienCreado, setRecienCreado] = useState<number | null>(null)
  const [editing, setEditing]           = useState<number | null>(null)
  const [editState, setEditState]       = useState<EditState>({ title: '', description: '' })
  const [previewKey, setPreviewKey]     = useState<string | null>(null)   // Spaces key or static URL
  const [previewTitle, setPreviewTitle] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; type: 'video' | 'instructivo' } | null>(null)
  const [addingNew, setAddingNew]       = useState(false)
  const [newForm, setNewForm]           = useState({ title: '', description: '' })
  const [migrating, setMigrating]       = useState(false)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})

  useEffect(() => { loadInstructivos() }, [])

  const loadInstructivos = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/videos/instructivos')
      const d = await r.json()
      if (d.success) setInstructivos(d.instructivos)
    } catch { toast.error('Error al cargar instructivos') }
    finally { setLoading(false) }
  }

  // ── Migrate static files to DO Spaces (client-side fetch → upload) ──────────
  const handleMigrateStatic = async () => {
    if (!confirm('Esto descargará los archivos instructivo1.mp4 e instructivo2.mp4 desde el servidor y los subirá a DO Spaces. ¿Continuar?')) return
    setMigrating(true)
    const pending = instructivos.filter(i => !i.videoKey)
    const results: string[] = []
    try {
      for (const item of pending) {
        const staticUrl = `/instructivo${item.id}.mp4`
        // 1. Fetch the static file from the server (browser side)
        let blob: Blob
        try {
          const res = await fetch(staticUrl)
          if (!res.ok) { results.push(`#${item.id}: archivo estático no encontrado (${res.status})`); continue }
          blob = await res.blob()
        } catch {
          results.push(`#${item.id}: no se pudo descargar ${staticUrl}`)
          continue
        }
        // 2. Upload as FormData to the existing instructivos upload endpoint
        const fd = new FormData()
        fd.append('id',          String(item.id))
        fd.append('title',       item.title)
        fd.append('description', item.description)
        fd.append('file',        new File([blob], `instructivo-${item.id}.mp4`, { type: 'video/mp4' }))
        const r = await fetch('/api/admin/videos/instructivos', { method: 'POST', body: fd })
        const d = await r.json()
        if (d.success) results.push(`#${item.id}: subido correctamente`)
        else results.push(`#${item.id}: error — ${d.error || 'desconocido'}`)
      }
      alert(`Migración completada:\n${results.join('\n')}`)
      await loadInstructivos()
    } catch (e: any) { toast.error(e.message || 'Error en migración') }
    finally { setMigrating(false) }
  }

  // ── Add new instructivo ─────────────────────────────────────────────────────
  const handleAddNew = async () => {
    if (!newForm.title.trim()) { toast.error('El título es requerido'); return }
    try {
      const nextId = instructivos.length > 0 ? Math.max(...instructivos.map(i => i.id)) + 1 : 1
      const r = await fetch('/api/admin/videos/instructivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nextId, title: newForm.title.trim(), description: newForm.description.trim() }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Instructivo creado — ahora súbele el video')
      setAddingNew(false)
      setNewForm({ title: '', description: '' })
      await loadInstructivos()
      setRecienCreado(nextId)
      // Llevar la vista a su tarjeta: el botón de subir está ahí, no arriba.
      setTimeout(() => {
        document.getElementById(`instructivo-${nextId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    } catch (e: any) { toast.error(e.message || 'Error al agregar') }
  }

  // ── Upload video ────────────────────────────────────────────────────────────
  const handleUpload = async (id: number, file: File) => {
    if (!file.type.startsWith('video/')) { toast.error('Solo se permiten archivos de video'); return }
    setUploading(id)
    try {
      const item = instructivos.find(i => i.id === id)!
      const fd   = new FormData()
      fd.append('id',          String(id))
      fd.append('title',       item.title)
      fd.append('description', item.description)
      fd.append('file',        file)
      const r = await fetch('/api/admin/videos/instructivos', { method: 'POST', body: fd })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Video subido correctamente')
      setRecienCreado(null)
      await loadInstructivos()
    } catch (e: any) { toast.error(e.message || 'Error al subir video') }
    finally { setUploading(null) }
  }

  // ── Delete video only ───────────────────────────────────────────────────────
  const handleDeleteVideo = async (id: number) => {
    try {
      const r = await fetch(`/api/admin/videos/instructivos?id=${id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Video eliminado')
      setConfirmDelete(null)
      await loadInstructivos()
    } catch (e: any) { toast.error(e.message || 'Error al eliminar video') }
  }

  // ── Delete entire instructivo ───────────────────────────────────────────────
  const handleDeleteInstructivo = async (id: number) => {
    try {
      // First delete the video file if any
      await fetch(`/api/admin/videos/instructivos?id=${id}`, { method: 'DELETE' })
      // Then remove the instructivo from the list via PATCH with remove flag
      const r = await fetch('/api/admin/videos/instructivos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, remove: true }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Instructivo eliminado')
      setConfirmDelete(null)
      await loadInstructivos()
    } catch (e: any) { toast.error(e.message || 'Error al eliminar') }
  }

  // ── Save metadata ───────────────────────────────────────────────────────────
  const handleSaveMeta = async (id: number) => {
    try {
      const r = await fetch('/api/admin/videos/instructivos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...editState }),
      })
      const d = await r.json()
      if (!d.success) throw new Error(d.error || 'Error')
      toast.success('Guardado')
      setEditing(null)
      await loadInstructivos()
    } catch (e: any) { toast.error(e.message || 'Error al guardar') }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button type="button" onClick={() => window.close()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Cerrar
          </button>
          <VideoCameraIcon className="h-6 w-6 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">Videos — Instructivos</h1>
          <span className="ml-auto text-sm text-gray-400 mr-4">{instructivos.length} instructivos</span>
          {instructivos.some(i => !i.videoKey) && (
            <button
              type="button"
              onClick={handleMigrateStatic}
              disabled={migrating}
              title="Sube los archivos estáticos del servidor a DO Spaces automáticamente"
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {migrating
                ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Migrando...</>
                : <><ArrowUpTrayIcon className="h-4 w-4" /> Migrar archivos estáticos</>
              }
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" /> Agregar Instructivo
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* New instructivo form */}
        {addingNew && (
          <div className="bg-white rounded-xl shadow-sm border-2 border-blue-300 overflow-hidden">
            <div className="bg-blue-50 px-6 py-4 flex items-center gap-3">
              <PlusIcon className="h-5 w-5 text-blue-600" />
              <span className="text-blue-700 font-semibold">Nuevo Instructivo</span>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Título <span className="text-red-500">*</span></label>
                <input
                  autoFocus
                  value={newForm.title}
                  onChange={e => setNewForm(s => ({ ...s, title: e.target.value }))}
                  placeholder="Ej: Instructivo 3"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
                <input
                  value={newForm.description}
                  onChange={e => setNewForm(s => ({ ...s, description: e.target.value }))}
                  placeholder="Ej: Cómo usar la plataforma avanzada"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                El <strong>video se sube después de guardar</strong>: al crearlo aparece su tarjeta abajo,
                con el botón <strong>“Subir Video”</strong>.
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleAddNew}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <CheckIcon className="h-4 w-4" /> Crear y subir el video
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingNew(false); setNewForm({ title: '', description: '' }) }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {instructivos.length === 0 && !addingNew && (
          <div className="text-center py-16 text-gray-500">
            <VideoCameraIcon className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p>No hay instructivos. Haz clic en <strong>Agregar Instructivo</strong> para comenzar.</p>
          </div>
        )}

        {instructivos.map(item => (
          <div
            key={item.id}
            id={`instructivo-${item.id}`}
            className={`bg-white rounded-xl shadow-sm overflow-hidden ${
              recienCreado === item.id
                ? 'border-2 border-blue-500 ring-2 ring-blue-200'
                : 'border border-gray-200'
            }`}
          >
            {/* Card header */}
            <div className="bg-blue-600 px-6 py-4 flex items-center gap-3">
              <VideoCameraIcon className="h-5 w-5 text-white" />
              <span className="text-white font-semibold">{item.title}</span>
              <span className="ml-auto flex items-center gap-2">
                {item.videoKey
                  ? <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">✓ Video cargado</span>
                  : <span className="px-2 py-0.5 bg-yellow-400 text-yellow-900 text-xs rounded-full">⚠ Pendiente — sin video subido</span>
                }
              </span>
            </div>

            <div className="p-6 space-y-4">
              {/* Metadata edit */}
              {editing === item.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Título</label>
                    <input
                      value={editState.title}
                      onChange={e => setEditState(s => ({ ...s, title: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
                    <input
                      value={editState.description}
                      onChange={e => setEditState(s => ({ ...s, description: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleSaveMeta(item.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                      <CheckIcon className="h-4 w-4" /> Guardar
                    </button>
                    <button type="button" onClick={() => setEditing(null)}
                      className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{item.title}</p>
                    <p className="text-sm text-gray-500">{item.description}</p>
                    {item.videoKey && (
                      <p className="text-xs text-gray-400 mt-1 font-mono">{item.videoKey}</p>
                    )}
                  </div>
                  <button type="button"
                    onClick={() => { setEditing(item.id); setEditState({ title: item.title, description: item.description }) }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-100">
                {/* Upload / Replace video */}
                <input
                  ref={el => { fileInputRefs.current[item.id] = el }}
                  type="file" accept="video/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(item.id, file)
                    e.target.value = ''
                  }}
                />
                <button type="button"
                  onClick={() => fileInputRefs.current[item.id]?.click()}
                  disabled={uploading === item.id}
                  className={`flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg disabled:opacity-50 transition-colors ${
                    item.videoKey
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-300 ring-offset-1 font-semibold'
                  }`}
                >
                  {uploading === item.id
                    ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Subiendo...</>
                    : <><ArrowUpTrayIcon className="h-4 w-4" /> {item.videoKey ? 'Reemplazar Video' : 'Subir Video'}</>
                  }
                </button>

                {/* Preview */}
                {(item.videoKey || true) && (
                  <button type="button"
                    onClick={() => {
                      setPreviewTitle(item.title)
                      setPreviewKey(item.videoKey
                        ? `/api/postgres/niveles/video?key=${encodeURIComponent(item.videoKey)}`
                        : `/instructivo${item.id}.mp4`
                      )
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <PlayIcon className="h-4 w-4" /> {item.videoKey ? 'Ver Video' : 'Ver (archivo estático)'}
                  </button>
                )}

                {/* Download */}
                {item.videoKey && (
                  <a
                    href={`/api/postgres/niveles/video?key=${encodeURIComponent(item.videoKey)}&download=1`}
                    download
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" /> Descargar
                  </a>
                )}

                {/* Delete video only */}
                {item.videoKey && (
                  <button type="button"
                    onClick={() => setConfirmDelete({ id: item.id, type: 'video' })}
                    className="flex items-center gap-2 px-4 py-2 text-orange-600 text-sm border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
                  >
                    <TrashIcon className="h-4 w-4" /> Quitar Video
                  </button>
                )}

                {/* Delete entire instructivo */}
                <button type="button"
                  onClick={() => setConfirmDelete({ id: item.id, type: 'instructivo' })}
                  className="ml-auto flex items-center gap-2 px-4 py-2 text-red-600 text-sm border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <TrashIcon className="h-4 w-4" /> Eliminar Instructivo
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Confirm Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {confirmDelete.type === 'video' ? 'Quitar video' : 'Eliminar instructivo'}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {confirmDelete.type === 'video'
                ? 'Se eliminará el archivo de video de DO Spaces. El instructivo permanecerá sin video.'
                : 'Se eliminará el instructivo completo (incluyendo su video). Esta acción no se puede deshacer.'
              }
            </p>
            <div className="flex gap-3">
              <button type="button"
                onClick={() =>
                  confirmDelete.type === 'video'
                    ? handleDeleteVideo(confirmDelete.id)
                    : handleDeleteInstructivo(confirmDelete.id)
                }
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
              >
                Confirmar
              </button>
              <button type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative w-full max-w-3xl bg-black rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900">
              <span className="text-white text-sm font-medium">{previewTitle || 'Vista previa'}</span>
              <button type="button" title="Cerrar" onClick={() => { setPreviewKey(null); setPreviewTitle('') }} className="text-gray-400 hover:text-white">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <video
                key={previewKey}
                src={previewKey}
                controls autoPlay className="w-full h-full"
              />
            </div>
            {!previewKey.includes('/api/') && (
              <div className="px-4 py-2 bg-gray-800 text-xs text-amber-400">
                ⚠ Reproduciendo desde archivo estático del servidor. Usa "Migrar archivos estáticos" para subirlo a DO Spaces.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
