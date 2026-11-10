'use client'

/**
 * Libro de Producción › detalle › "Ajuste Escalera": corrige la escalera comercial del
 * titular (Full Executive, Jefe de grupo, Gerente, Gerente división, Sales
 * Manager, Filial y Origen matrícula). Sugiere los nombres ya usados en el país; la filial
 * se elige del catálogo del país. Motivo obligatorio; el cambio queda en el Seguimiento.
 * API: GET/PATCH /api/postgres/libro-produccion/[titularId]/escalera.
 */

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { api, handleApiError } from '@/hooks/use-api'

const CAMPOS: [string, string][] = [
  ['fullExecutive', 'Full Executive'], ['jefeGrupo', 'Jefe de grupo'],
  ['gerente', 'Gerente'], ['gerenteDivision', 'Gerente división'], ['salesManager', 'Sales Manager'],
  ['filial', 'Filial'], ['origenMatricula', 'Origen matrícula'],
]

interface Opciones { pais: string | null; actual: Record<string, string>; sugerencias: Record<string, string[]>; filiales: string[] }

export default function AjusteEscaleraModal({ titularId, contrato, onClose, onGuardado }: {
  titularId: string; contrato: string | null; onClose: () => void
  onGuardado: (comercial: Record<string, string | null>) => void
}) {
  const [op, setOp] = useState<Opciones | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    api.get<Opciones>(`/api/postgres/libro-produccion/${titularId}/escalera`)
      .then(d => { setOp(d); setForm({ ...d.actual }) })
      .catch(e => { handleApiError(e, 'No se pudo cargar la escala'); onClose() })
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titularId])

  // ── Leer correo: texto pegado o captura (pegar con Ctrl+V o elegir archivo) ──
  const [correo, setCorreo] = useState('')
  const [captura, setCaptura] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [lectura, setLectura] = useState<{ contratoCorreo: string | null; coincideContrato: boolean | null; omitidos: string[]; n: number } | null>(null)

  // La captura se reduce (≤1600 px, JPG) antes de enviarla: menos peso y menos costo de IA.
  const cargarImagen = (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('La captura debe ser una imagen'); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k)
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
      setCaptura(cv.toDataURL('image/jpeg', 0.85)); URL.revokeObjectURL(url)
    }
    img.src = url
  }
  const alPegar = (e: React.ClipboardEvent) => {
    const f = Array.from(e.clipboardData.files || []).find(x => x.type.startsWith('image/'))
    if (f) { e.preventDefault(); cargarImagen(f) }
  }

  const leerCorreo = async () => {
    setLeyendo(true)
    try {
      const d = await api.post<{ contratoCorreo: string | null; coincideContrato: boolean | null; campos: Record<string, string>; omitidos: string[] }>(
        `/api/postgres/libro-produccion/${titularId}/escalera/leer-correo`, captura ? { imagen: captura } : { texto: correo })
      if (d.coincideContrato === false && !window.confirm(`El correo es del contrato ${d.contratoCorreo}, no del ${contrato}. ¿Usar sus datos igual?`)) return
      const n = Object.keys(d.campos).length
      if (!n) { toast.error('No se encontró la escala de matrícula en el correo'); return }
      setForm(f => ({ ...f, ...d.campos }))
      if (!motivo.trim()) setMotivo(`Según correo de la matrícula${d.contratoCorreo ? ` N° ${d.contratoCorreo}` : ''} (lectura automática)`)
      setLectura({ contratoCorreo: d.contratoCorreo, coincideContrato: d.coincideContrato, omitidos: d.omitidos || [], n })
      toast.success('Correo leído: revisa los campos resaltados y guarda')
    } catch (e) {
      handleApiError(e, 'No se pudo leer el correo')
    } finally {
      setLeyendo(false)
    }
  }

  const cambiados = op ? CAMPOS.filter(([k]) => (form[k] || '').trim() !== (op.actual[k] || '').trim()) : []

  const guardar = async () => {
    setGuardando(true)
    try {
      const body: Record<string, string> = { motivo }
      for (const [k] of cambiados) body[k] = form[k] || ''
      const res = await fetch(`/api/postgres/libro-produccion/${titularId}/escalera`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok || !j?.success) throw new Error(j?.details || j?.error || `Error ${res.status}`)
      toast.success('Escala ajustada')
      onGuardado(j.comercial)
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-3 text-left text-gray-900 normal-case font-normal" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ajuste Escala</h2>
            <p className="text-xs text-gray-500">Contrato {contrato || '—'}{op?.pais ? ` · ${op.pais}` : ''} · escala comercial del día de la matrícula</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        {!op ? (
          <p className="p-10 text-center text-sm italic text-gray-400">Cargando…</p>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <details className="rounded-lg border border-indigo-200 bg-indigo-50/40 px-3 py-2" open={!lectura}>
              <summary className="cursor-pointer text-sm font-semibold text-indigo-800">Leer correo de la matrícula</summary>
              <div className="mt-2 space-y-2">
                {captura ? (
                  <div className="flex items-start gap-3">
                    <img src={captura} alt="Captura del correo" className="max-h-32 rounded border border-gray-200" />
                    <button type="button" onClick={() => setCaptura(null)} className="text-xs text-red-600 hover:underline">Quitar captura</button>
                  </div>
                ) : (
                  <textarea value={correo} onChange={e => setCorreo(e.target.value)} onPaste={alPegar} rows={3}
                    placeholder="Pega aquí el texto del correo (o una captura con Ctrl+V)…"
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
                    Subir captura
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) cargarImagen(f); e.target.value = '' }} />
                  </label>
                  <button type="button" onClick={leerCorreo} disabled={leyendo || (!captura && !correo.trim())}
                    className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {leyendo ? 'Leyendo…' : 'Leer y llenar'}
                  </button>
                  <span className="text-[11px] text-gray-500">Solo llena el formulario: revisa y guarda.</span>
                </div>
              </div>
            </details>
            {lectura && (
              <div className={`rounded-md px-3 py-2 text-xs ${lectura.coincideContrato === false ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
                Leído del correo{lectura.contratoCorreo ? ` (contrato ${lectura.contratoCorreo}${lectura.coincideContrato === false ? ' — NO es este contrato' : ''})` : ''}: {lectura.n} campo(s).
                {lectura.omitidos.map(o => <div key={o} className="text-gray-600">No se cambió (se conserva el registrado): {o}</div>)}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CAMPOS.map(([k, l]) => {
                const cambio = (form[k] || '').trim() !== (op.actual[k] || '').trim()
                const cls = `w-full rounded-md border px-2.5 py-1.5 text-sm ${cambio ? 'border-amber-400 bg-amber-50/50' : 'border-gray-300'}`
                return (
                  <label key={k} className="text-xs text-gray-600">
                    <span className="mb-0.5 block">{l}{cambio && <span className="ml-1 text-amber-700">· antes: {op.actual[k] || '—'}</span>}</span>
                    {k === 'filial' ? (
                      <select value={form.filial || ''} onChange={e => setForm(f => ({ ...f, filial: e.target.value }))} className={`${cls} bg-white`}>
                        <option value="">— Sin filial —</option>
                        {/* La filial actual se muestra aunque ya no esté activa en el catálogo. */}
                        {op.actual.filial && !op.filiales.includes(op.actual.filial) && <option value={op.actual.filial}>{op.actual.filial} (fuera del catálogo)</option>}
                        {op.filiales.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    ) : (
                      <>
                        <input value={form[k] || ''} list={`esc-${k}`} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={cls} />
                        <datalist id={`esc-${k}`}>{(op.sugerencias[k] || []).map(v => <option key={v} value={v} />)}</datalist>
                      </>
                    )}
                  </label>
                )
              })}
            </div>
            <label className="block text-xs text-gray-600">
              <span className="mb-0.5 block">Motivo del ajuste * <span className="text-gray-400">(mínimo 10 caracteres; queda en el Seguimiento)</span></span>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" placeholder="Ej.: el enlace del CRM no trajo la escala; confirmado con el jefe de grupo" />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{cambiados.length ? `${cambiados.length} campo(s) modificado(s)` : 'Sin cambios'}</span>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={guardando} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={guardar} disabled={guardando || !cambiados.length || motivo.trim().length < 10}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
