'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'
import { isDriveUrl } from '@/lib/drive-embed'

interface MaterialFile {
  key: string
  name: string
}

interface StepMaterial {
  _id: string
  step: string
  description: string
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

  // Enlace de Google Drive (solo material del guía)
  const [linkModal, setLinkModal] = useState<{ stepId: string; step: string } | null>(null)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [savingLink, setSavingLink] = useState(false)

  // Actividades WordWall del módulo (solo material del guía) — misma fuente que Contenido.
  const [modActs, setModActs] = useState<{ nombre: string; link: string }[]>([])
  const [savingActs, setSavingActs] = useState(false)

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

  // Cargar actividades WordWall del módulo (solo material del guía)
  useEffect(() => {
    if (tipo !== 'advisor' || !curso || !selectedNivel) { setModActs([]); return }
    fetch(`/api/postgres/cursos-contenido?curso=${encodeURIComponent(curso)}&code=${encodeURIComponent(selectedNivel)}`)
      .then(r => r.json())
      .then(d => setModActs(Array.isArray(d?.actividadesWordwall) ? d.actividadesWordwall : []))
      .catch(() => setModActs([]))
  }, [tipo, curso, selectedNivel])

  async function saveActs() {
    if (!curso || !selectedNivel) return
    setSavingActs(true)
    try {
      const r = await fetch('/api/postgres/cursos-contenido', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curso, code: selectedNivel,
          actividadesWordwall: modActs.map(a => ({ nombre: (a.nombre || '').trim(), link: (a.link || '').trim() })).filter(a => a.nombre || a.link),
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Error al guardar actividades')
      toast.success('Actividades del módulo guardadas')
    } catch (err: any) {
      toast.error(err.message ?? 'Error inesperado')
    } finally {
      setSavingActs(false)
    }
  }

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

  // ── Agregar enlace de Google Drive (solo advisor) ──────────────────────────
  async function submitLink() {
    if (!linkModal) return
    const name = linkName.trim()
    const url = linkUrl.trim()
    if (!name) { toast.error('Escribe un título'); return }
    if (!isDriveUrl(url)) { toast.error('La URL debe ser de Google Drive o Google Docs'); return }
    setSavingLink(true)
    try {
      const r = await fetch('/api/postgres/materials/manage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId: linkModal.stepId, tipo, nivel: selectedNivel, step: linkModal.step, name, url }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Error al agregar enlace')
      toast.success('Enlace de Drive agregado')
      setLinkModal(null); setLinkName(''); setLinkUrl('')
      await loadSteps(selectedNivel)
    } catch (err: any) {
      toast.error(err.message ?? 'Error inesperado')
    } finally {
      setSavingLink(false)
    }
  }

  // ── Copiar enlace al portapapeles ──────────────────────────────────────────
  async function copyLink(file: MaterialFile) {
    const isLink = isDriveUrl(file.key) || /^https?:\/\//.test(file.key)
    const url = isLink
      ? file.key
      : `${window.location.origin}/api/postgres/niveles/material?key=${encodeURIComponent(file.key)}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Enlace copiado')
    } catch {
      // Fallback si clipboard no está disponible
      window.prompt('Copia el enlace:', url)
    }
  }

  // ── Log download ───────────────────────────────────────────────────────────
  async function handleDownload(stepRow: StepMaterial, file: MaterialFile) {
    // Enlace de Drive u otra URL http → abrir directo
    if (isDriveUrl(file.key) || /^https?:\/\//.test(file.key)) {
      window.open(file.key, '_blank', 'noopener,noreferrer')
      return
    }
    // Archivo en Spaces → proxy de descarga
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

        {/* Actividades WordWall del módulo (solo material del guía) */}
        {tipo === 'advisor' && selectedNivel && (
          <div className="bg-white rounded-xl border border-pink-200 shadow-sm p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-pink-700">Actividades del módulo (WordWall)</h3>
                <p className="text-xs text-gray-500">Aplican a todo el módulo <strong>{selectedNivel}</strong> — el estudiante las ve sin importar su lección. Puedes agregar varias.</p>
              </div>
              <button type="button" onClick={() => setModActs(a => [...a, { nombre: '', link: '' }])}
                className="text-xs px-2 py-1 rounded-md bg-pink-100 text-pink-700 hover:bg-pink-200 flex-shrink-0">
                + Agregar actividad
              </button>
            </div>
            {modActs.length === 0 ? (
              <p className="text-xs text-gray-400 mt-2">Sin actividades. Agrega una con nombre y link de WordWall.</p>
            ) : (
              <div className="space-y-2 mt-3">
                {modActs.map((act, idx) => {
                  const validLink = /^https?:\/\//.test((act.link || '').trim())
                  return (
                    <div key={idx} className="flex gap-2 items-start">
                      <input value={act.nombre} type="text"
                        onChange={e => setModActs(a => a.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                        placeholder="Título (ej. WordWall Módulo 1)"
                        className="w-1/3 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      <input value={act.link} type="url"
                        onChange={e => setModActs(a => a.map((x, i) => i === idx ? { ...x, link: e.target.value } : x))}
                        placeholder="https://wordwall.net/…"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      <button type="button" disabled={!validLink}
                        onClick={() => window.open(act.link, '_blank', 'noopener,noreferrer')}
                        className="text-[11px] px-2 py-2 rounded border border-gray-200 text-blue-600 hover:bg-blue-50 disabled:opacity-40 flex-shrink-0"
                        title="Abrir actividad">Abrir</button>
                      <button type="button" disabled={!validLink}
                        onClick={async () => { try { await navigator.clipboard.writeText(act.link.trim()); toast.success('Enlace copiado') } catch { window.prompt('Copia el enlace:', act.link.trim()) } }}
                        className="text-[11px] px-2 py-2 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 flex-shrink-0"
                        title="Copiar enlace">Copiar</button>
                      <button type="button" onClick={() => setModActs(a => a.filter((_, i) => i !== idx))}
                        className="text-sm px-2 py-2 rounded-md text-red-600 hover:bg-red-50 flex-shrink-0" title="Quitar actividad">✕</button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={saveActs} disabled={savingActs}
                className="text-sm px-4 py-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50">
                {savingActs ? 'Guardando…' : 'Guardar actividades'}
              </button>
            </div>
          </div>
        )}

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
                <div className={`px-5 py-3 border-b border-gray-100 ${accent.light} flex items-start justify-between gap-3`}>
                  <div className="min-w-0">
                    <span className={`font-semibold text-sm ${accent.text}`}>{row.step}</span>
                    {row.description && (
                      <p className="text-xs text-gray-600 mt-0.5">{row.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{row.files.length} archivo{row.files.length !== 1 ? 's' : ''}</span>
                </div>

                {/* Files */}
                <div className="px-5 py-3">
                  {row.files.length === 0 && (
                    <p className="text-sm text-gray-400 italic py-1">Sin archivos</p>
                  )}
                  {row.files.map(file => {
                    const esLink = isDriveUrl(file.key) || /^https?:\/\//.test(file.key)
                    return (
                    <div key={file.key} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {esLink ? (
                            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                            </svg>
                          )}
                          <span className="text-sm text-gray-800 font-medium truncate">{file.name}</span>
                          {esLink && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 flex-shrink-0">enlace</span>}
                        </div>
                        {/* Link visible + copiar */}
                        <div className="flex items-center gap-2 mt-1 pl-6">
                          {esLink ? (
                            <a href={file.key} target="_blank" rel="noopener noreferrer" title={file.key}
                              className="text-xs text-blue-600 truncate max-w-[52ch] hover:underline">{file.key}</a>
                          ) : (
                            <span className="text-xs text-gray-400">Archivo subido</span>
                          )}
                          <button type="button" onClick={() => copyLink(file)}
                            className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0 inline-flex items-center gap-1"
                            title="Copiar enlace">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Copiar enlace
                          </button>
                        </div>
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
                    ) })}
                </div>

                {/* Add new file (no replace) */}
                <div className={`px-5 pb-3 flex items-center gap-4`}>
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
                  {tipo === 'advisor' && (
                    <button
                      type="button"
                      onClick={() => { setLinkModal({ stepId: row._id, step: row.step }); setLinkName(''); setLinkUrl('') }}
                      className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5" />
                      </svg>
                      Agregar enlace de Drive
                    </button>
                  )}
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

      {/* Modal: agregar enlace de Google Drive */}
      {linkModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 115.656 5.656l-1.5 1.5" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">Agregar enlace de Google Drive</h2>
            <p className="text-xs text-gray-400 text-center mb-4">
              Módulo: <strong>{selectedNivel}</strong> · Lección: <strong>{linkModal.step}</strong>
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
            <input
              type="text"
              value={linkName}
              onChange={e => setLinkName(e.target.value)}
              placeholder="Ej. Presentación Lección 02"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Enlace de Google Drive</label>
            <input
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/…/view"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {linkUrl.trim() !== '' && !isDriveUrl(linkUrl) && (
              <p className="text-xs text-red-500 mt-1">La URL debe ser de Google Drive o Google Docs.</p>
            )}
            <p className="text-xs text-gray-500 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ El archivo en Drive debe estar compartido como <strong>“Cualquiera con el enlace: Lector”</strong>,
              de lo contrario no se verá en la plataforma. Sirve para PDF, PowerPoint (.pptx) y Google Slides.
            </p>

            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setLinkModal(null)}
                disabled={savingLink}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitLink}
                disabled={savingLink || !linkName.trim() || !isDriveUrl(linkUrl)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {savingLink ? 'Guardando…' : 'Agregar enlace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
