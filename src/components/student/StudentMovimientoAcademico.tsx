'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

interface Props {
  studentId: string
  studentName: string
  campaign?: string | null
  curso?: string | null
  currentModulo?: string | null
  currentLeccion?: string | null
  onClose: () => void
  onSuccess: () => void
}

interface ModuloOpt { code: string; steps: string[] }
interface Preview {
  bloqueadoWelcome: boolean
  encontrado: boolean
  direccion: 'adelante' | 'atras' | 'igual'
  aprobar: number; aprobarEval: number
  perder: number; perderEval: number
  destino: { modulo: string; leccion: string; orden: number | null }
}

export default function StudentMovimientoAcademico({
  studentId, studentName, campaign, curso, currentModulo, currentLeccion, onClose, onSuccess,
}: Props) {
  const [modulos, setModulos] = useState<ModuloOpt[]>([])
  const [loadingMods, setLoadingMods] = useState(true)
  const [selModulo, setSelModulo] = useState('')
  const [selLeccion, setSelLeccion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Salones (otras campañas) cerca de la lección ELEGIDA — referencia informativa.
  const [recos, setRecos] = useState<any[] | null>(null)
  const [loadingRecos, setLoadingRecos] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoadingMods(true)
        const r = await fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso || '')}`)
        const d = await r.json()
        if (alive && d?.modulos) setModulos(d.modulos)
      } catch { /* noop */ } finally { if (alive) setLoadingMods(false) }
    })()
    return () => { alive = false }
  }, [curso])

  const lecciones = modulos.find(m => m.code === selModulo)?.steps || []
  // reset preview cuando cambia la selección
  useEffect(() => { setPreview(null); setConfirm(false) }, [selModulo, selLeccion])

  // Al elegir la lección destino, buscar salones (otras campañas) cerca de ESA lección.
  useEffect(() => {
    if (!selModulo || !selLeccion) { setRecos(null); return }
    let alive = true
    setLoadingRecos(true)
    fetch(`/api/postgres/students/${studentId}/recomendar-salones?modulo=${encodeURIComponent(selModulo)}&leccion=${encodeURIComponent(selLeccion)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!alive) return; const x = d.data || d; setRecos(x.candidatos || []) })
      .catch(() => { if (alive) setRecos([]) })
      .finally(() => { if (alive) setLoadingRecos(false) })
    return () => { alive = false }
  }, [studentId, selModulo, selLeccion])

  const gapLabel = (g: number | null) =>
    g == null ? '—' : g === 0 ? '✅ En esta lección' : g > 0 ? `⏭ ${g} adelante` : `⏮ ${Math.abs(g)} atrás`
  const gapCls = (g: number | null) =>
    g === 0 ? 'bg-green-100 text-green-800' : g == null ? 'bg-gray-100 text-gray-500'
    : Math.abs(g) <= 2 ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'

  const verImpacto = async () => {
    if (!selModulo || !selLeccion) { toast.error('Elige módulo y lección'); return }
    setLoadingPrev(true); setError(null)
    try {
      const r = await fetch(`/api/postgres/students/${studentId}/movimiento-academico?modulo=${encodeURIComponent(selModulo)}&leccion=${encodeURIComponent(selLeccion)}`)
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d?.error || 'No se pudo calcular el impacto')
      setPreview(d.preview as Preview)
    } catch (e: any) { setError(e.message || 'Error') } finally { setLoadingPrev(false) }
  }

  const ejecutar = async () => {
    setSubmitting(true); setError(null)
    try {
      const r = await fetch(`/api/postgres/students/${studentId}/movimiento-academico`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modulo: selModulo, leccion: selLeccion, motivo }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d?.error || 'No se pudo aplicar el ajuste')
      toast.success('Ajuste de lecciones aplicado')
      onSuccess()
    } catch (e: any) { setError(e.message || 'Error'); setSubmitting(false) }
  }

  const dirLabel = preview?.direccion === 'adelante' ? 'Hacia adelante' : preview?.direccion === 'atras' ? 'Hacia atrás' : 'Misma posición'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={() => { if (!submitting) onClose() }} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xl">🔀</span>
          <h3 className="text-lg font-semibold text-gray-900">Ajuste Lecciones</h3>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">{studentName}</p>

          {/* Posición actual */}
          <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3 text-sm">
            <div><span className="text-xs text-gray-500 block">Campaña</span>{campaign || '—'}</div>
            <div><span className="text-xs text-gray-500 block">Curso</span>{curso || '—'}</div>
            <div><span className="text-xs text-gray-500 block">Módulo actual</span><strong>{currentModulo || '—'}</strong></div>
            <div><span className="text-xs text-gray-500 block">Lección actual</span><strong>{currentLeccion || '—'}</strong></div>
          </div>

          {/* Selección destino */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nuevo módulo</label>
              <select value={selModulo} onChange={e => { setSelModulo(e.target.value); setSelLeccion('') }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" disabled={loadingMods}>
                <option value="">{loadingMods ? 'Cargando…' : 'Seleccionar…'}</option>
                {modulos.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nueva lección</label>
              <select value={selLeccion} onChange={e => setSelLeccion(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" disabled={!selModulo}>
                <option value="">Seleccionar…</option>
                {lecciones.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* Salones cerca de la lección elegida (referencia — el ajuste NO cambia de salón) */}
          {selModulo && selLeccion && (
            <div className="border border-primary-100 bg-primary-50/40 rounded-lg px-3 py-2">
              <p className="text-sm font-medium text-primary-800">🎯 Salones cerca de {selModulo} · {selLeccion}</p>
              <p className="text-[11px] text-gray-500 mb-1.5">Salones de otras campañas ordenados por cercanía a la lección elegida (referencia; el ajuste no traslada de aula).</p>
              {loadingRecos ? (
                <p className="text-xs text-gray-500 py-1">Buscando salones…</p>
              ) : !recos || recos.length === 0 ? (
                <p className="text-xs text-gray-500 py-1">No hay otros salones del curso para comparar.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {recos.slice(0, 8).map((c) => (
                    <div key={c.cursoCampaignId} className="bg-white border border-gray-200 rounded-md px-2.5 py-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{c.campaign} · Salón {c.salon || '—'}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${gapCls(c.gap)}`}>{gapLabel(c.gap)}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
                        <span>{c.horarioCurso}</span>
                        <span>· va en {c.moduloActual} / {c.leccionActual}</span>
                        <span className={c.lleno ? 'text-red-600 font-medium' : ''}>· {c.cupos.inscritos}/{c.cupos.total}{c.lleno ? ' LLENO' : ''}</span>
                        {c.guia && <span>· {c.guia}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>}

          {!preview && (
            <button type="button" onClick={verImpacto} disabled={!selModulo || !selLeccion || loadingPrev}
              className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              {loadingPrev ? 'Calculando…' : 'Ver impacto'}
            </button>
          )}

          {/* Impacto + confirmación */}
          {preview && (
            <div className="space-y-3">
              {preview.bloqueadoWelcome ? (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                  El alumno está en el puente <strong>WELCOME</strong>. Promuévelo a su curso real (Aprobar Welcome) antes de moverlo.
                </div>
              ) : !preview.encontrado ? (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
                  La lección destino no está en la secuencia del alumno.
                </div>
              ) : preview.direccion === 'igual' ? (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-600">
                  El destino es la misma posición actual; no hay cambio que aplicar.
                </div>
              ) : (
                <>
                  <div className={`rounded-lg p-3 text-sm border ${preview.direccion === 'adelante' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <p className="font-semibold text-gray-800 mb-1">{dirLabel} → {preview.destino.modulo} · {preview.destino.leccion}</p>
                    {preview.direccion === 'adelante' ? (
                      <p className="text-gray-700">Se <strong>aprobarán {preview.aprobar}</strong> lección(es) anteriores{preview.aprobarEval > 0 ? ` (incl. ${preview.aprobarEval} evaluación/es)` : ''}, con la nota <em>"Movimiento Académico"</em>.</p>
                    ) : (
                      <p className="text-gray-700">Se <strong>perderán {preview.perder}</strong> lección(es) aprobadas desde el destino{preview.perderEval > 0 ? ` (incl. ${preview.perderEval} evaluación/es)` : ''}. Se guarda respaldo en la auditoría.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Motivo (opcional)</label>
                    <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Ej. corrección de posición" />
                  </div>

                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-0.5" />
                    <span>Confirmo mover a <strong>{studentName}</strong> a {preview.destino.modulo} · {preview.destino.leccion}.</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
          {preview && preview.encontrado && !preview.bloqueadoWelcome && preview.direccion !== 'igual' && (
            <button type="button" onClick={ejecutar} disabled={!confirm || submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
              {submitting ? 'Aplicando…' : 'Confirmar ajuste'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
