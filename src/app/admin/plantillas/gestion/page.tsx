'use client'

import { useEffect, useState, type ReactNode } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import {
  ChatBubbleLeftRightIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
  XMarkIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import {
  AVAILABLE_PLACEHOLDERS,
  extractPlaceholders,
  fillTemplate,
  type RecipientContext,
} from '@/lib/message-template-filler'

/** Datos de ejemplo para la vista previa: así se ve el mensaje con un destinatario real. */
const EJEMPLO_DESTINATARIO: RecipientContext = {
  nombre: 'Sofía',
  primerApellido: 'González',
  nivel: 'Modulo 01',
  step: 'Leccion 03',
  plataforma: 'Chile',
  contrato: '01-M5-09000-26',
  numeroId: '12345678K',
  academicaId: 'acd_ejemplo',
  apoderado: 'Carolina Rojas',
  curso: 'KODOMO',
  fechaTaller: 'viernes 16-10-2026',
  horaTaller: '18:00',
}

/**
 * Formato de WhatsApp: *negrita*, _cursiva_, ~tachado~. Devuelve nodos React
 * (nunca HTML crudo) para que el texto de la plantilla no pueda inyectar marcado.
 */
function formatoWhatsApp(texto: string): ReactNode[] {
  const rx = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g
  return texto.split(rx).map((parte, i) => {
    if (parte.length > 2) {
      const inner = parte.slice(1, -1)
      if (parte.startsWith('*') && parte.endsWith('*')) return <strong key={i}>{inner}</strong>
      if (parte.startsWith('_') && parte.endsWith('_')) return <em key={i}>{inner}</em>
      if (parte.startsWith('~') && parte.endsWith('~')) return <s key={i}>{inner}</s>
    }
    return <span key={i}>{parte}</span>
  })
}

interface Template {
  _id: string
  slug: string
  nombre: string
  descripcion: string | null
  contenido: string
  placeholders: string[]
  activo: boolean
  _owner: string | null
  _createdDate: string
  _updatedDate: string
}

type EditorMode = 'create' | 'edit' | null

export default function GestionPlantillasPage() {
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [editing, setEditing] = useState<Partial<Template>>({})
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Template | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  const load = async (withInactive = includeInactive) => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/admin/plantillas?includeInactive=${withInactive}`)
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      setItems(j.items as Template[])
    } catch (e: any) {
      setError(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(includeInactive) }, [includeInactive])

  const openCreate = () => {
    setEditing({ slug: '', nombre: '', descripcion: '', contenido: '', activo: true })
    setShowPreview(false)
    setEditorMode('create')
  }

  const openEdit = (t: Template) => {
    setEditing({ ...t })
    setShowPreview(false)
    setEditorMode('edit')
  }

  const closeEditor = () => {
    if (saving) return
    setEditorMode(null)
    setEditing({})
    setShowPreview(false)
  }

  // Placeholders que el envío no conoce: se reemplazan por vacío, así que se avisan.
  const placeholdersDesconocidos = extractPlaceholders(editing.contenido || '')
    .filter(p => !(AVAILABLE_PLACEHOLDERS as readonly string[]).includes(p))
  const mensajePreview = fillTemplate(editing.contenido || '', EJEMPLO_DESTINATARIO)

  const handleSave = async () => {
    if (!editing.nombre?.trim() || !editing.contenido?.trim()) {
      toast.error('Nombre y contenido son requeridos')
      return
    }
    if (editorMode === 'create' && !editing.slug?.trim()) {
      toast.error('Slug requerido')
      return
    }
    setSaving(true)
    try {
      const isCreate = editorMode === 'create'
      const url = isCreate ? '/api/admin/plantillas' : `/api/admin/plantillas/${editing._id}`
      const method = isCreate ? 'POST' : 'PATCH'
      const body: any = {
        nombre: editing.nombre,
        descripcion: editing.descripcion || null,
        contenido: editing.contenido,
      }
      if (isCreate) body.slug = editing.slug
      else body.activo = editing.activo

      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      toast.success(isCreate ? 'Plantilla creada' : 'Plantilla actualizada')
      closeEditor()
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setSaving(true)
    try {
      const r = await fetch(`/api/admin/plantillas/${deleteConfirm._id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      toast.success('Plantilla desactivada')
      setDeleteConfirm(null)
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Error al desactivar')
    } finally {
      setSaving(false)
    }
  }

  const insertPlaceholder = (key: string) => {
    setEditing(e => ({ ...e, contenido: (e.contenido || '') + `{{${key}}}` }))
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.PLANTILLAS_GESTION}>
        <div className="max-w-5xl mx-auto py-6 space-y-4">
          {/* Header */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-full flex-shrink-0">
                  <ChatBubbleLeftRightIcon className="h-7 w-7 text-indigo-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Gestión de Plantillas</h1>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Mensajes WhatsApp usados en el envío individual y masivo. Soporta placeholders dinámicos.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={e => setIncludeInactive(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Incluir inactivas
                </label>
                <button
                  type="button"
                  onClick={() => load()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Recargar
                </button>
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <PlusIcon className="h-4 w-4" />
                  Nueva plantilla
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">{error}</div>
          )}

          {/* Tabla */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <p className="p-6 text-center text-sm text-gray-500">Cargando…</p>
            ) : items.length === 0 ? (
              <p className="p-8 text-center text-sm text-gray-400">
                No hay plantillas. Crea la primera con el botón "Nueva plantilla".
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-xs text-gray-500 uppercase">
                    <th className="text-left font-medium px-4 py-2">Nombre</th>
                    <th className="text-left font-medium px-4 py-2">Slug</th>
                    <th className="text-left font-medium px-4 py-2">Contenido (preview)</th>
                    <th className="text-left font-medium px-4 py-2 w-20">Estado</th>
                    <th className="text-right font-medium px-4 py-2 w-28">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(t => (
                    <tr key={t._id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{t.nombre}</div>
                        {t.descripcion && <div className="text-xs text-gray-500 mt-0.5">{t.descripcion}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{t.slug}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 max-w-md">
                        <span className="line-clamp-2">{t.contenido}</span>
                        {t.placeholders.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.placeholders.map(p => (
                              <span key={p} className="inline-block bg-indigo-50 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded">
                                {`{{${p}}}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.activo ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Activa</span>
                        ) : (
                          <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full font-medium">Inactiva</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            title="Editar"
                            className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          {t.activo && (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(t)}
                              title="Desactivar"
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Editor modal (crear / editar) */}
        {editorMode && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black bg-opacity-60 overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl my-8">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {editorMode === 'create' ? 'Nueva plantilla' : 'Editar plantilla'}
                </h2>
                <button type="button" onClick={closeEditor} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3">
                {editorMode === 'create' && (
                  <div>
                    <label htmlFor="slug-input" className="block text-xs font-medium text-gray-700 mb-1">
                      Slug (identificador) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="slug-input"
                      type="text"
                      value={editing.slug || ''}
                      onChange={e => setEditing(s => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                      placeholder="ej. recordatorio-clase"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                      maxLength={60}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Solo minúsculas, números y guiones. NO se puede cambiar después.</p>
                  </div>
                )}

                <div>
                  <label htmlFor="nombre-input" className="block text-xs font-medium text-gray-700 mb-1">
                    Nombre <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="nombre-input"
                    type="text"
                    value={editing.nombre || ''}
                    onChange={e => setEditing(s => ({ ...s, nombre: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    maxLength={120}
                  />
                </div>

                <div>
                  <label htmlFor="desc-input" className="block text-xs font-medium text-gray-700 mb-1">Descripción</label>
                  <input
                    id="desc-input"
                    type="text"
                    value={editing.descripcion || ''}
                    onChange={e => setEditing(s => ({ ...s, descripcion: e.target.value }))}
                    placeholder="Opcional — explica cuándo usar esta plantilla"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="contenido-input" className="block text-xs font-medium text-gray-700 mb-1">
                    Contenido <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="contenido-input"
                    value={editing.contenido || ''}
                    onChange={e => setEditing(s => ({ ...s, contenido: e.target.value.slice(0, 1000) }))}
                    rows={5}
                    placeholder="Hola {{nombre}}, tu nivel actual es {{nivel}} - {{step}}…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-[11px] text-gray-500">Click en un placeholder para insertarlo:</p>
                    <p className="text-[10px] text-gray-400">{(editing.contenido || '').length}/1000</p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {AVAILABLE_PLACEHOLDERS.map(k => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => insertPlaceholder(k)}
                        className="text-[11px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-0.5 rounded-full"
                      >
                        {`{{${k}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                {showPreview && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-700">Vista previa del mensaje</p>
                      <p className="text-[11px] text-gray-500">
                        Con datos de ejemplo: {EJEMPLO_DESTINATARIO.nombre} {EJEMPLO_DESTINATARIO.primerApellido}
                      </p>
                    </div>
                    <div className="p-4 bg-[#efeae2] max-h-80 overflow-y-auto">
                      {mensajePreview.trim() ? (
                        <div className="ml-auto max-w-[85%] bg-[#d9fdd3] rounded-lg rounded-tr-none px-3 py-2 shadow-sm">
                          <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                            {formatoWhatsApp(mensajePreview)}
                          </p>
                          <p className="text-[10px] text-gray-500 text-right mt-1">
                            {new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} ✓✓
                          </p>
                        </div>
                      ) : (
                        <p className="text-center text-xs text-gray-500">Escribe el contenido para ver cómo queda.</p>
                      )}
                    </div>
                    {placeholdersDesconocidos.length > 0 && (
                      <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
                        ⚠ No reconocidos (saldrán vacíos al enviar):{' '}
                        {placeholdersDesconocidos.map(p => `{{${p}}}`).join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {editorMode === 'edit' && (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={editing.activo !== false}
                      onChange={e => setEditing(s => ({ ...s, activo: e.target.checked }))}
                      className="rounded border-gray-300"
                    />
                    Plantilla activa (visible en el dropdown de envío)
                  </label>
                )}
              </div>

              <div className="mt-5 flex items-center gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowPreview(v => !v)}
                  className="mr-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                >
                  {showPreview ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  {showPreview ? 'Ocultar vista previa' : 'Vista previa'}
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : (editorMode === 'create' ? 'Crear' : 'Guardar cambios')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal confirmación de desactivar */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Desactivar plantilla</h3>
              <p className="text-sm text-gray-600 mb-4">
                <strong>{deleteConfirm.nombre}</strong> dejará de aparecer en el dropdown de envío.
                Puedes reactivarla después marcando &quot;Incluir inactivas&quot; arriba.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? 'Desactivando…' : 'Desactivar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
