'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

interface ModuloOpt { code: string; steps: string[] }
interface Candidato {
  cursoCampaignId: string; campaign: string; salon: string | null; horarioCurso: string
  guia: string | null; moduloActual: string | null; leccionActual: string | null
  gap: number | null; cupos: { inscritos: number; total: number }; lleno: boolean; esSalonActual: boolean
}

interface Props {
  studentId: string          // ACADEMICA._id
  studentName: string
  curso?: string | null      // tipoCurso real del alumno
  currentCampaign?: string | null
  currentSalon?: string | null
  currentModulo?: string | null
  currentLeccion?: string | null
  onClose: () => void
  onSuccess: () => void
}

/**
 * «Búsqueda Lección»: se elige módulo y lección del curso del alumno, se buscan en
 * todas las campañas los salones que van en esa lección o en una anterior, y el
 * admin marca uno. Al aceptar se abre un caso «Cambio de curso» asignado a Servicio
 * Académico; desde aquí mismo se puede confirmar el cambio (curso, salón y lección).
 */
export default function StudentBusquedaLeccion({
  studentId, studentName, curso, currentCampaign, currentSalon, currentModulo, currentLeccion, onClose, onSuccess,
}: Props) {
  const [modulos, setModulos] = useState<ModuloOpt[]>([])
  const [selModulo, setSelModulo] = useState(currentModulo || '')
  const [selLeccion, setSelLeccion] = useState('')
  const [cands, setCands] = useState<Candidato[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState('')
  const [motivo, setMotivo] = useState('')
  const [paso, setPaso] = useState<'buscar' | 'asignado'>('buscar')
  const [caso, setCaso] = useState<{ casoId: string; codigo: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/postgres/niveles?curso=${encodeURIComponent(curso || '')}`)
      .then(r => r.json()).then(d => { if (alive && d?.modulos) setModulos(d.modulos) })
      .catch(() => toast.error('No se pudieron cargar los módulos'))
    return () => { alive = false }
  }, [curso])

  const lecciones = modulos.find(m => m.code === selModulo)?.steps || []
  const sel = cands?.find(c => c.cursoCampaignId === elegido) || null
  const etiqueta = (c: Candidato) => `${c.campaign} · ${curso} · Salón ${c.salon || '—'} · ${c.horarioCurso}`

  const buscar = async () => {
    setBuscando(true); setCands(null); setElegido('')
    try {
      const r = await fetch(`/api/postgres/students/${studentId}/recomendar-salones?modulo=${encodeURIComponent(selModulo)}&leccion=${encodeURIComponent(selLeccion)}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok || d.error) throw new Error(d.error || 'No se pudo buscar')
      if (d.bloqueadoWelcome) throw new Error('El alumno sigue en WELCOME: primero hay que promoverlo a su curso.')
      // Misma lección (gap 0) o una por debajo (gap < 0); el salón actual no cuenta.
      setCands((d.candidatos as Candidato[]).filter(c => !c.esSalonActual && c.gap != null && c.gap <= 0))
    } catch (e: any) { toast.error(e.message || 'Error'); setCands([]) }
    finally { setBuscando(false) }
  }

  const post = async (payload: any) => {
    const r = await fetch(`/api/postgres/students/${studentId}/busqueda-leccion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) throw new Error(d.error || 'No se pudo completar la acción')
    return d
  }
  const destinoBody = () => sel && ({ campaign: sel.campaign, tipoCurso: curso, horarioCurso: sel.horarioCurso })

  const asignar = async () => {
    if (!sel) return
    setSaving(true)
    try {
      const d = await post({ action: 'asignar', ...destinoBody(), moduloBuscado: selModulo, leccionBuscada: selLeccion, motivo: motivo.trim() })
      setCaso({ casoId: d.casoId, codigo: d.codigo })
      setPaso('asignado')
      toast.success(`Caso ${d.codigo} asignado a Servicio Académico`)
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const confirmar = async () => {
    if (!sel || !caso) return
    setSaving(true)
    try {
      await post({ action: 'confirmar', ...destinoBody(), casoId: caso.casoId, motivo: motivo.trim() })
      toast.success('Cambio de curso aplicado')
      onSuccess()
    } catch (e: any) { toast.error(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xl">🔎</span>
          <h3 className="text-lg font-semibold text-gray-900">Búsqueda Lección</h3>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Beneficiario</p>
            <p className="text-base font-semibold text-gray-900">{studentName}</p>
            <p className="text-xs text-gray-500">
              {curso || '—'} · {currentCampaign || '—'} · Salón {currentSalon || '—'} · va en {currentModulo || '—'} · {currentLeccion || '—'}
            </p>
          </div>

          {paso === 'buscar' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
                  <select value={selModulo} onChange={e => { setSelModulo(e.target.value); setSelLeccion(''); setCands(null) }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">Seleccione…</option>
                    {modulos.map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
                  <select value={selLeccion} onChange={e => { setSelLeccion(e.target.value); setCands(null) }} disabled={!selModulo}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50">
                    <option value="">Seleccione…</option>
                    {lecciones.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <button type="button" onClick={buscar} disabled={!selModulo || !selLeccion || buscando}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
                {buscando ? 'Buscando…' : 'Buscar salones'}
              </button>

              {cands && (
                cands.length === 0 ? (
                  <p className="text-sm text-gray-500">Ningún salón de otras campañas va en esa lección o en una anterior.</p>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50">
                      Salones en <strong>{selLeccion}</strong> o en una lección anterior. Marque uno.
                    </p>
                    <ul className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                      {cands.map(c => (
                        <li key={c.cursoCampaignId} className={`px-3 py-2 flex items-center gap-3 text-sm ${c.lleno ? 'opacity-50' : ''}`}>
                          <input type="checkbox" checked={elegido === c.cursoCampaignId} disabled={c.lleno}
                            onChange={e => setElegido(e.target.checked ? c.cursoCampaignId : '')} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900">{c.campaign} · Salón {c.salon || '—'} · {c.horarioCurso}</p>
                            <p className="text-xs text-gray-500">
                              Va en {c.moduloActual || '—'} · {c.leccionActual || '—'}
                              {c.guia ? ` · ${c.guia}` : ''} · {c.cupos.inscritos}/{c.cupos.total}{c.lleno ? ' · SIN CUPO' : ''}
                            </p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${c.gap === 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {c.gap === 0 ? 'Misma lección' : `${Math.abs(c.gap as number)} abajo`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}

              {sel && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Motivo <span className="text-red-500">*</span></label>
                  <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                    placeholder="Motivo del cambio de curso (obligatorio)…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                Caso <strong>{caso?.codigo}</strong> · <strong>Cambio de curso</strong> asignado a Servicio Académico.
              </div>
              {sel && (
                <dl className="grid grid-cols-3 gap-y-2 text-sm">
                  <dt className="text-gray-500">Destino</dt>
                  <dd className="col-span-2 font-medium text-gray-900">{etiqueta(sel)}</dd>
                  <dt className="text-gray-500">Lección</dt>
                  <dd className="col-span-2 text-gray-700">La que lleve el salón destino ({sel.moduloActual} · {sel.leccionActual})</dd>
                </dl>
              )}
              <p className="text-sm text-gray-600">
                Si Servicio confirma ahora, se cambia al alumno de curso, salón y lección y el caso se cierra como «Salón cambiado».
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-3">
          <button type="button" onClick={() => paso === 'asignado' ? onSuccess() : onClose()} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50">
            {paso === 'asignado' ? 'Dejar para Servicio' : 'Cancelar'}
          </button>
          {paso === 'buscar' ? (
            <button type="button" onClick={asignar} disabled={!sel || !motivo.trim() || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
              {saving ? 'Asignando…' : 'Aceptar y asignar a Servicio Académico'}
            </button>
          ) : (
            <button type="button" onClick={confirmar} disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50">
              {saving ? 'Aplicando…' : 'Confirmar cambio de curso'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
