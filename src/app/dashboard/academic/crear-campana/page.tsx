'use client'

import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO, horariosFor, esMenores, addMonths } from '@/lib/cursos-campaign'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

interface CursoDraft {
  tipoCurso: string
  horarioCurso: string
  inicioCurso: string
  duracionCurso: number
  finalCurso: string
  numeroUsuarios: number
}

const EMPTY: CursoDraft = { tipoCurso: '', horarioCurso: '', inicioCurso: '', duracionCurso: 0, finalCurso: '', numeroUsuarios: 0 }
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100'
const lblCls = 'block text-sm font-medium text-gray-700 mb-1'

export default function CrearCampanaPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.CAMPANA_CREAR} showDefaultMessage>
        <CrearCampanaContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function CrearCampanaContent() {
  const [campaign, setCampaign] = useState('')
  const [inicioCampania, setInicioCampania] = useState('')
  const [cursos, setCursos] = useState<CursoDraft[]>([])
  const [form, setForm] = useState<CursoDraft>(EMPTY)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [existing, setExisting] = useState<any[]>([])
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const loadExisting = useCallback(() => {
    fetch('/api/postgres/campaigns')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then(d => setExisting(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => {})
  }, [])
  useEffect(() => { loadExisting() }, [loadExisting])

  const finalCurso = form.inicioCurso && form.duracionCurso > 0 ? addMonths(form.inicioCurso, form.duracionCurso) : ''
  const canAdd = !!(form.tipoCurso && form.horarioCurso && form.inicioCurso && form.duracionCurso > 0 && form.numeroUsuarios > 0)

  const requestAdd = () => {
    if (!canAdd) { setMsg({ type: 'err', text: 'Complete tipo de curso, horario, inicio, duración (meses) y número de usuarios.' }); return }
    setMsg(null)
    setConfirmOpen(true)
  }
  const confirmAdd = () => {
    setCursos([...cursos, { ...form, finalCurso }])
    setForm(EMPTY)
    setConfirmOpen(false)
  }
  const removeCurso = (i: number) => setCursos(cursos.filter((_, j) => j !== i))

  const submit = async () => {
    if (!campaign.trim()) { setMsg({ type: 'err', text: 'El nombre de la campaña es obligatorio.' }); return }
    if (cursos.length === 0) { setMsg({ type: 'err', text: 'Agregue al menos un curso a la campaña.' }); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/postgres/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: campaign.trim(), inicioCampania: inicioCampania || null, cursos }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error al crear la campaña')
      setMsg({ type: 'ok', text: `Campaña "${campaign.trim()}" guardada con ${d.creados} curso(s).` })
      setCampaign(''); setInicioCampania(''); setCursos([])
      loadExisting()
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) } finally { setSaving(false) }
  }

  const horariosOpts = horariosFor(form.tipoCurso)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Crea Campaña</h1>
        <p className="mt-2 text-gray-600">Crea campañas con sus cursos. Estos cursos alimentan el wizard de Crear Contrato.</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-md text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {/* Datos de la campaña */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Datos de la campaña</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lblCls}>Nombre de la campaña *</label>
            <input type="text" value={campaign} onChange={e => setCampaign(e.target.value)} className={inputCls} placeholder="Ej. VERANO2026" />
          </div>
          <div>
            <label className={lblCls}>Inicio de campaña (apertura de matrícula)</label>
            <input type="date" value={inicioCampania} onChange={e => setInicioCampania(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Agregar curso */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Agregar curso</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={lblCls}>Tipo de curso *</label>
            <select value={form.tipoCurso} onChange={e => setForm({ ...form, tipoCurso: e.target.value, horarioCurso: '' })} className={inputCls}>
              <option value="">Seleccionar...</option>
              {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}{esMenores(t) ? ' (menores)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>Horario *</label>
            <select value={form.horarioCurso} disabled={!form.tipoCurso} onChange={e => setForm({ ...form, horarioCurso: e.target.value })} className={inputCls}>
              <option value="">Seleccionar...</option>
              {horariosOpts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>N° de usuarios (cupos) *</label>
            <input type="number" min={1} value={form.numeroUsuarios || ''} onChange={e => setForm({ ...form, numeroUsuarios: parseInt(e.target.value || '0', 10) || 0 })} className={inputCls} />
          </div>
          <div>
            <label className={lblCls}>Inicio del curso *</label>
            <input type="date" value={form.inicioCurso} onChange={e => setForm({ ...form, inicioCurso: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={lblCls}>Duración (meses) *</label>
            <input type="number" min={1} value={form.duracionCurso || ''} onChange={e => setForm({ ...form, duracionCurso: parseInt(e.target.value || '0', 10) || 0 })} className={inputCls} />
          </div>
          <div>
            <label className={lblCls}>Final del curso (calculado)</label>
            <input type="text" value={finalCurso} disabled className={inputCls} placeholder="—" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={requestAdd}
            className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
            <PlusIcon className="h-4 w-4 mr-1" /> Agregar Curso
          </button>
        </div>
      </div>

      {/* Cursos agregados */}
      {cursos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Cursos de la campaña ({cursos.length})</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2">Tipo</th><th>Horario</th><th>Inicio</th><th>Duración</th><th>Final</th><th>Cupos</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cursos.map((c, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-medium">{c.tipoCurso}</td>
                  <td>{c.horarioCurso}</td>
                  <td>{c.inicioCurso}</td>
                  <td>{c.duracionCurso} mes(es)</td>
                  <td>{c.finalCurso || '—'}</td>
                  <td>{c.numeroUsuarios}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => removeCurso(i)} className="text-red-600 hover:text-red-700" title="Quitar curso">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={submit} disabled={saving}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-accent-600 hover:bg-accent-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Crear Campaña'}
            </button>
          </div>
        </div>
      )}

      {/* Campañas existentes */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Campañas existentes</h2>
        {existing.length === 0 ? (
          <p className="text-gray-500 text-sm">Aún no hay cursos/campañas creados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2">Campaña</th><th>Tipo</th><th>Horario</th><th>Inicio curso</th><th>Final</th><th>Cupos (insc/total)</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((r: any) => {
                const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                return (
                  <tr key={r._id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{r.campaign}</td>
                    <td>{r.tipoCurso}</td>
                    <td>{r.horarioCurso}</td>
                    <td>{r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '—'}</td>
                    <td>{r.finalCurso ? String(r.finalCurso).slice(0, 10) : '—'}</td>
                    <td>{r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${full ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {full ? 'FULL' : `${(r.numeroUsuarios ?? 0) - (r.usuInscritos ?? 0)} cupos`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de confirmación al agregar curso */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Confirmar curso</h3>
            <div className="text-sm text-gray-700 space-y-1 mb-5">
              <p><b>Tipo:</b> {form.tipoCurso}{esMenores(form.tipoCurso) ? ' (menores)' : ''}</p>
              <p><b>Horario:</b> {form.horarioCurso}</p>
              <p><b>Inicio:</b> {form.inicioCurso} · <b>Duración:</b> {form.duracionCurso} mes(es)</p>
              <p><b>Final:</b> {finalCurso || '—'}</p>
              <p><b>Cupos:</b> {form.numeroUsuarios}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={confirmAdd} className="px-4 py-2 text-sm rounded-md text-white bg-primary-600 hover:bg-primary-700">Confirmar y agregar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
