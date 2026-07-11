'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

interface MaterialFile {
  key: string
  name: string
}

interface StepMaterial {
  _id: string
  step: string
  files: MaterialFile[]
}

interface Props {
  tipo: 'usuario' | 'advisor'
  title: string
  description: string
  accentColor: string   // tailwind color name e.g. 'blue' | 'green'
}

const FIELD_LABEL: Record<string, string> = { usuario: 'materialUsuario', advisor: 'material' }

export default function MaterialManagePage({ tipo, title, description, accentColor }: Props) {
  const [curso, setCurso] = useState('')
  const [modulos, setModulos] = useState<{ code: string; steps: string[] }[]>([])
  const [selectedNivel, setSelectedNivel] = useState('')   // code del módulo seleccionado
  const [steps, setSteps] = useState<StepMaterial[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingModulos, setLoadingModulos] = useState(false)

  // Modal state
  const [modal, setModal] = useState<{
    type: 'delete' | 'replace'
    stepId: string; step: string; nivel: string
    file?: MaterialFile
    newFile?: File
  } | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Hidden file input per step
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  // ── Curso → módulos ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!curso) { setModulos([]); setSelectedNivel(''); setSteps([]); return }
    setLoadingModulos(true); setSelectedNivel(''); setSteps([])
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setModulos(data.modulos ?? []))
      .catch(() => toast.error('Error cargando módulos'))
      .finally(() => setLoadingModulos(false))
  }, [curso])

  // ── Load steps (lecciones) del módulo seleccionado, scopeado por curso ──────
  const loadSteps = useCallback(async (nivel: string) => {
    if (!nivel || !curso) { setSteps([]); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/postgres/materials/manage?nivel=${encodeURIComponent(nivel)}&curso=${encodeURIComponent(curso)}&tipo=${tipo}`)
      const data = await r.json()
      setSteps(data.steps ?? [])
    } catch {
      toast.error('Error cargando materiales')
    } finally {
      setLoading(false)
    }
  }, [tipo, curso])

  useEffect(() => { loadSteps(selectedNivel) }, [selectedNivel, loadSteps])

  // ── Trigger file picker ────────────────────────────────────────────────────
  function triggerFilePick(stepId: string) {
    fileInputRefs.current.get(stepId)?.click()
  }

  function onFileSelected(stepRow: StepMaterial, file: File, existingFile?: MaterialFile) {
    setModal({
      type: 'replace',
      stepId: stepRow._id,
      step: stepRow.step,
      nivel: selectedNivel,
      file: existingFile,
      newFile: file,
    })
  }

  // ── Confirm delete ─────────────────────────────────────────────────────────
  function promptDelete(stepRow: StepMaterial, file: MaterialFile) {
    setModal({ type: 'delete', stepId: stepRow._id, step: stepRow.step, nivel: selectedNivel, file })
  }

  // ── Execute confirmed action ───────────────────────────────────────────────
  async function executeAction() {
    if (!modal) return
    setConfirming(true)
    try {
      if (modal.type === 'delete') {
        const r = await fetch('/api/postgres/materials/manage', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepId: modal.stepId,
            tipo,
            nivel: modal.nivel,
            step: modal.step,
            fileKey: modal.file?.key,
          }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Error al borrar')
        toast.success('Material eliminado')

      } else {
        // replace / upload
        const form = new FormData()
        form.append('nivel', modal.nivel)
        form.append('step', modal.step)
        form.append('stepId', modal.stepId)
        form.append('tipo', tipo)
        form.append('curso', curso)
        form.append('file', modal.newFile as File)
        if (modal.file?.key) form.append('archivoAnterior', modal.file.key)

        const r = await fetch('/api/postgres/materials/manage', { method: 'POST', body: form })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Error al subir')
        toast.success('Material actualizado')
      }

      setModal(null)
      await loadSteps(selectedNivel)
    } catch (err: any) {
      toast.error(err.message ?? 'Error inesperado')
    } finally {
      setConfirming(false)
    }
  }

  // ── Log download ───────────────────────────────────────────────────────────
  async function handleDownload(stepRow: StepMaterial, file: MaterialFile) {
    // Open in new tab
    window.open(`/api/postgres/niveles/material?key=${encodeURIComponent(file.key)}`, '_blank', 'noopener,noreferrer')
    // Audit log (fire and forget)
    fetch('/api/postgres/materials/manage', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, nivel: selectedNivel, step: stepRow.step, fileKey: file.key }),
    }).catch(() => {})
  }

  // ── Color helpers (tailwind needs full class names) ────────────────────────
  const accent = accentColor === 'blue'
    ? { border: 'border-blue-500', bg: 'bg-blue-600', hover: 'hover:bg-blue-700', light: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-500' }
    : { border: 'border-green-500', bg: 'bg-green-600', hover: 'hover:bg-green-700', light: 'bg-green-50', text: 'text-green-600', ring: 'ring-green-500' }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-gray-500 text-sm mt-1">{description}</p>
          </div>
          <button
            type="button"
            onClick={() => window.close()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cerrar
          </button>
        </div>

        {/* Selectores: Curso → Módulo */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Curso</label>
            <select
              value={curso}
              onChange={e => setCurso(e.target.value)}
              className="w-full sm:w-56 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent"
              style={{ '--tw-ring-color': accentColor === 'blue' ? '#3b82f6' : '#22c55e' } as any}
            >
              <option value="">-- Selecciona un curso --</option>
              {TIPOS_CURSO.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Módulo</label>
            <select
              value={selectedNivel}
              onChange={e => setSelectedNivel(e.target.value)}
              disabled={!curso || loadingModulos}
              className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent"
              style={{ '--tw-ring-color': accentColor === 'blue' ? '#3b82f6' : '#22c55e' } as any}
            >
              <option value="">{loadingModulos ? 'Cargando…' : '-- Selecciona un módulo --'}</option>
              {modulos.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </div>
        </div>

        {/* Steps table */}
        {!selectedNivel && (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Selecciona un curso y un módulo para ver y gestionar el material</p>
          </div>
        )}

        {selectedNivel && loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        )}

        {selectedNivel && !loading && steps.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            No se encontraron lecciones para el módulo <strong>{selectedNivel}</strong>.
          </div>
        )}

        {selectedNivel && !loading && steps.length > 0 && (
          <div className="space-y-3">
            {steps.map(row => (
              <div key={row._id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Step header */}
                <div className={`px-5 py-3 border-b border-gray-100 ${accent.light} flex items-center justify-between`}>
                  <span className={`font-semibold text-sm ${accent.text}`}>{row.step}</span>
                  <span className="text-xs text-gray-400">{row.files.length} archivo{row.files.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Files */}
                <div className="px-5 py-3">
                  {row.files.length === 0 && (
                    <p className="text-sm text-gray-400 italic py-1">Sin archivos</p>
                  )}
                  {row.files.map(file => (
                    <div key={file.key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm text-gray-700 truncate">{file.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                        {/* Descargar */}
                        <button
                          type="button"
                          onClick={() => handleDownload(row, file)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                          title="Descargar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        {/* Reemplazar */}
                        <button
                          type="button"
                          onClick={() => triggerFilePick(`${row._id}-replace-${file.key}`)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 transition"
                          title="Reemplazar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                        </button>
                        <input
                          type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.zip"
                          className="hidden"
                          ref={el => { if (el) fileInputRefs.current.set(`${row._id}-replace-${file.key}`, el) }}
                          onChange={e => {
                            const f = e.target.files?.[0]
                            if (f) onFileSelected(row, f, file)
                            e.target.value = ''
                          }}
                        />
                        {/* Borrar */}
                        <button
                          type="button"
                          onClick={() => promptDelete(row, file)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                          title="Borrar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add new file (no replace) */}
                <div className={`px-5 pb-3`}>
                  <button
                    type="button"
                    onClick={() => triggerFilePick(`${row._id}-add`)}
                    className={`text-xs font-medium ${accent.text} hover:underline flex items-center gap-1`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Agregar archivo
                  </button>
                  <input
                    type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.zip"
                    className="hidden"
                    ref={el => { if (el) fileInputRefs.current.set(`${row._id}-add`, el) }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) onFileSelected(row, f, undefined)
                      e.target.value = ''
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            {modal.type === 'delete' ? (
              <>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 text-center mb-2">¿Eliminar material?</h2>
                <p className="text-sm text-gray-500 text-center mb-1">
                  Estás a punto de eliminar el archivo:
                </p>
                <p className="text-sm font-medium text-gray-800 text-center bg-gray-50 rounded-lg px-3 py-2 mb-1">
                  {modal.file?.name}
                </p>
                <p className="text-xs text-gray-400 text-center mb-6">
                  Curso: <strong>{curso}</strong> · Módulo: <strong>{modal.nivel}</strong> · Lección: <strong>{modal.step}</strong>
                </p>
                <p className="text-xs text-red-500 text-center mb-6">Esta acción no se puede deshacer.</p>
              </>
            ) : (
              <>
                <div className={`w-12 h-12 ${accent.light} rounded-full flex items-center justify-center mx-auto mb-4`}>
                  <svg className={`w-6 h-6 ${accent.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-900 text-center mb-2">
                  {modal.file ? 'Confirmar reemplazo' : 'Confirmar carga'}
                </h2>
                {modal.file && (
                  <>
                    <p className="text-xs text-gray-400 text-center mb-1">Archivo actual:</p>
                    <p className="text-sm text-gray-500 text-center bg-red-50 rounded-lg px-3 py-1.5 mb-3 line-through">
                      {modal.file.name}
                    </p>
                  </>
                )}
                <p className="text-xs text-gray-400 text-center mb-1">Nuevo archivo:</p>
                <p className="text-sm font-medium text-gray-800 text-center bg-gray-50 rounded-lg px-3 py-2 mb-1">
                  {modal.newFile?.name}
                </p>
                <p className="text-xs text-gray-400 text-center mb-6">
                  Curso: <strong>{curso}</strong> · Módulo: <strong>{modal.nivel}</strong> · Lección: <strong>{modal.step}</strong>
                </p>
              </>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={confirming}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeAction}
                disabled={confirming}
                className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition disabled:opacity-50 ${
                  modal.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : `${accent.bg} ${accent.hover}`
                }`}
              >
                {confirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Procesando…
                  </span>
                ) : modal.type === 'delete' ? 'Eliminar' : (modal.file ? 'Reemplazar' : 'Subir')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
