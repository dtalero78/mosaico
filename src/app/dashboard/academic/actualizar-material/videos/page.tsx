'use client'

import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO } from '@/lib/cursos-campaign'

interface Leccion {
  code: string
  step: string
  description: string | null
  videoUrl: string | null
  video: string | null
  previewUrl: string | null
}

function LeccionRow({
  curso, leccion, onChanged,
}: { curso: string; leccion: Leccion; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkVal, setLinkVal] = useState(leccion.video || '')
  const [preview, setPreview] = useState(false)

  const patch = async (payload: Record<string, any>) => {
    setBusy(true)
    try {
      const r = await fetch('/api/postgres/cursos-videos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code: leccion.code, step: leccion.step, ...payload }),
      }).then((x) => x.json())
      if (r.error) throw new Error(r.error)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('video/')) { toast.error('Selecciona un archivo de video (MP4)'); return }
    setBusy(true)
    try {
      const pres = await fetch('/api/postgres/cursos-videos/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso, code: leccion.code, step: leccion.step, contentType: file.type }),
      }).then((r) => r.json())
      if (!pres.presignedUrl) throw new Error(pres.error || 'No se pudo firmar la subida')
      const put = await fetch(pres.presignedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) throw new Error('Falló la subida a almacenamiento')
      await patch({ videoUrl: pres.key })
      toast.success(`Video de ${leccion.step} actualizado`)
    } catch (e: any) {
      toast.error(e?.message || 'Error al subir el video')
      setBusy(false)
    }
  }

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2 text-sm font-medium text-gray-900 whitespace-nowrap">{leccion.step}</td>
        <td className="px-3 py-2 text-sm text-gray-500 max-w-xs truncate">{leccion.description || '—'}</td>
        <td className="px-3 py-2">
          {leccion.videoUrl ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">MP4</span>
          ) : leccion.video ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">Enlace</span>
          ) : (
            <span className="text-xs text-gray-400">Sin video</span>
          )}
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded transition-colors">
              {leccion.videoUrl ? 'Reemplazar MP4' : 'Subir MP4'}
              <input type="file" accept="video/mp4,video/*" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
            </label>
            <button type="button" disabled={busy}
              onClick={() => { setLinkVal(leccion.video || ''); setLinkOpen((v) => !v) }}
              className="px-2.5 py-1 border border-blue-300 text-blue-600 hover:bg-blue-50 text-xs rounded transition-colors">
              Enlace
            </button>
            {(leccion.previewUrl || leccion.video) && (
              <button type="button" onClick={() => (leccion.videoUrl ? setPreview(true) : window.open(leccion.video!, '_blank'))}
                className="px-2.5 py-1 border border-gray-300 text-gray-600 hover:bg-gray-100 text-xs rounded transition-colors">
                Ver
              </button>
            )}
            {leccion.videoUrl && (
              <button type="button" disabled={busy} onClick={() => confirm('¿Quitar el MP4?') && patch({ videoUrl: null })}
                className="px-2.5 py-1 border border-red-300 text-red-600 hover:bg-red-50 text-xs rounded transition-colors">
                Quitar MP4
              </button>
            )}
            {busy && <span className="text-xs text-gray-400">…</span>}
          </div>
          {linkOpen && (
            <div className="mt-2 flex items-center gap-2">
              <input value={linkVal} onChange={(e) => setLinkVal(e.target.value)} placeholder="https://youtube.com/..."
                className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-xs" />
              <button type="button" disabled={busy}
                onClick={async () => { await patch({ video: linkVal.trim() || null }); setLinkOpen(false); toast.success('Enlace guardado') }}
                className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded">Guardar</button>
              {leccion.video && (
                <button type="button" disabled={busy}
                  onClick={async () => { await patch({ video: null }); setLinkVal(''); setLinkOpen(false) }}
                  className="px-2.5 py-1 border border-red-300 text-red-600 text-xs rounded">Quitar</button>
              )}
            </div>
          )}
        </td>
      </tr>
      {preview && leccion.previewUrl && (
        <tr>
          <td colSpan={4} className="px-3 py-3 bg-gray-50">
            <div className="flex flex-col gap-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={leccion.previewUrl} controls className="max-h-80 rounded" />
              <button type="button" onClick={() => setPreview(false)} className="self-start text-xs text-gray-500 hover:text-gray-700">Cerrar preview</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function VideosCursoPage() {
  const [curso, setCurso] = useState('')
  const [modulos, setModulos] = useState<{ code: string; steps: string[] }[]>([])
  const [code, setCode] = useState('')
  const [lecciones, setLecciones] = useState<Leccion[]>([])
  const [loadingMod, setLoadingMod] = useState(false)
  const [loadingLec, setLoadingLec] = useState(false)

  // Curso → módulos
  useEffect(() => {
    if (!curso) { setModulos([]); setCode(''); setLecciones([]); return }
    setLoadingMod(true); setCode(''); setLecciones([])
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setModulos(d.modulos || []))
      .catch(() => toast.error('Error al cargar módulos'))
      .finally(() => setLoadingMod(false))
  }, [curso])

  const loadLecciones = useCallback(() => {
    if (!curso || !code) { setLecciones([]); return }
    setLoadingLec(true)
    fetch(`/api/postgres/cursos-videos?curso=${encodeURIComponent(curso)}&code=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setLecciones(d.lecciones || []))
      .catch(() => toast.error('Error al cargar lecciones'))
      .finally(() => setLoadingLec(false))
  }, [curso, code])

  useEffect(() => { loadLecciones() }, [loadLecciones])

  return (
    <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Videos del curso</h1>
        <p className="text-gray-500 mb-6">
          Gestiona el video de cada lección: sube un MP4 o guarda un enlace externo (YouTube). Selecciona curso y módulo.
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={(e) => setCurso(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[180px]">
              <option value="">— Selecciona —</option>
              {TIPOS_CURSO.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
            <select value={code} onChange={(e) => setCode(e.target.value)} disabled={!curso || loadingMod}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[220px] disabled:bg-gray-100">
              <option value="">{loadingMod ? 'Cargando…' : '— Selecciona —'}</option>
              {modulos.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </div>
        </div>

        {loadingLec ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : code && lecciones.length > 0 ? (
          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                  <th className="px-3 py-2">Lección</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Video</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lecciones.map((l) => (
                  <LeccionRow key={`${l.code}-${l.step}`} curso={curso} leccion={l} onChanged={loadLecciones} />
                ))}
              </tbody>
            </table>
          </div>
        ) : code ? (
          <p className="text-sm text-gray-400 py-8 text-center">Este módulo no tiene lecciones.</p>
        ) : (
          <p className="text-sm text-gray-400 py-8 text-center">Selecciona un curso y un módulo para gestionar sus videos.</p>
        )}
      </div>
    </PermissionGuard>
  )
}
