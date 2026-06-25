'use client'

import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO, horariosFor, esMenores, addMonths } from '@/lib/cursos-campaign'
import { exportToExcel } from '@/lib/export-excel'
import { PlusIcon, TrashIcon, PencilSquareIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'

interface CursoDraft {
  tipoCurso: string
  salon: string
  guia: string
  horarioCurso: string
  inicioCurso: string
  duracionCurso: number
  finalCurso: string
  numeroUsuarios: number
}

const EMPTY: CursoDraft = { tipoCurso: '', salon: '', guia: '', horarioCurso: '', inicioCurso: '', duracionCurso: 0, finalCurso: '', numeroUsuarios: 0 }
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
  const [finalCampaign, setFinalCampaign] = useState('')
  const [cursos, setCursos] = useState<CursoDraft[]>([])
  const [form, setForm] = useState<CursoDraft>(EMPTY)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [existing, setExisting] = useState<any[]>([])
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  // Edición / borrado de cursos ya guardados (tabla "Campañas existentes")
  const [editRow, setEditRow] = useState<any | null>(null)
  const [editMsg, setEditMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<any | null>(null)
  const [rowBusy, setRowBusy] = useState(false)
  // Pestañas + filtros del Reporte (inputs = draft; se aplican con "Aplicar filtros")
  const [activeTab, setActiveTab] = useState<'gestion' | 'reporte'>('gestion')
  const [repNombre, setRepNombre] = useState('')
  const [repCurso, setRepCurso] = useState('')
  const [repDesde, setRepDesde] = useState('')
  const [repHasta, setRepHasta] = useState('')
  const [repEstado, setRepEstado] = useState<'todos' | 'finalizada' | 'progreso'>('todos')
  const [applied, setApplied] = useState<{ nombre: string; curso: string; desde: string; hasta: string; estado: 'todos' | 'finalizada' | 'progreso' }>({ nombre: '', curso: '', desde: '', hasta: '', estado: 'todos' })
  const aplicarFiltros = () => setApplied({ nombre: repNombre, curso: repCurso, desde: repDesde, hasta: repHasta, estado: repEstado })
  const limpiarFiltros = () => { setRepNombre(''); setRepCurso(''); setRepDesde(''); setRepHasta(''); setRepEstado('todos'); setApplied({ nombre: '', curso: '', desde: '', hasta: '', estado: 'todos' }) }

  const [guias, setGuias] = useState<{ _id: string; nombreCompleto: string }[]>([])
  const guiaNombre = useCallback((id: any) => {
    if (!id) return '—'
    const g = guias.find(x => x._id === id)
    return g ? g.nombreCompleto : String(id)
  }, [guias])

  const loadExisting = useCallback(() => {
    fetch('/api/postgres/campaigns')
      .then(r => (r.ok ? r.json() : { rows: [] }))
      .then(d => setExisting(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => {})
  }, [])
  useEffect(() => { loadExisting() }, [loadExisting])
  useEffect(() => {
    fetch('/api/postgres/guias')
      .then(r => (r.ok ? r.json() : { guias: [] }))
      .then(d => setGuias(Array.isArray(d.guias) ? d.guias.map((a: any) => ({ _id: a._id, nombreCompleto: a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim() || a.email || a._id })) : []))
      .catch(() => {})
  }, [])

  // Final del curso = inicio + (duración + 1) meses.
  const finalCurso = form.inicioCurso && form.duracionCurso > 0 ? addMonths(form.inicioCurso, form.duracionCurso + 1) : ''
  const canAdd = !!(form.tipoCurso && form.horarioCurso && form.inicioCurso && form.duracionCurso > 0 && form.numeroUsuarios > 0)

  const requestAdd = () => {
    if (!canAdd) { setMsg({ type: 'err', text: 'Complete tipo de curso, horario, inicio, duración (meses) y número de usuarios.' }); return }
    setMsg(null)
    setConfirmOpen(true)
  }
  const confirmAdd = () => {
    const nuevo = { ...form, finalCurso }
    if (editIndex !== null) {
      setCursos(cursos.map((c, i) => (i === editIndex ? nuevo : c)))
      setEditIndex(null)
    } else {
      setCursos([...cursos, nuevo])
    }
    setForm(EMPTY)
    setConfirmOpen(false)
  }
  const editCurso = (i: number) => { setForm(cursos[i]); setEditIndex(i); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const removeCurso = (i: number) => {
    setCursos(cursos.filter((_, j) => j !== i))
    if (editIndex === i) { setForm(EMPTY); setEditIndex(null) }
  }
  const cancelEdit = () => { setForm(EMPTY); setEditIndex(null) }

  const submit = async () => {
    if (!campaign.trim()) { setMsg({ type: 'err', text: 'El nombre de la campaña es obligatorio.' }); return }
    if (cursos.length === 0) { setMsg({ type: 'err', text: 'Agregue al menos un curso a la campaña.' }); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/postgres/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign: campaign.trim(), inicioCampania: inicioCampania || null, finalCampaign: finalCampaign || null, cursos }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error al crear la campaña')
      setMsg({ type: 'ok', text: `Campaña "${campaign.trim()}" guardada con ${d.creados} curso(s).` })
      setCampaign(''); setInicioCampania(''); setFinalCampaign(''); setCursos([]); setForm(EMPTY); setEditIndex(null)
      loadExisting()
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) } finally { setSaving(false) }
  }

  const handleCSV = () => {
    exportToExcel(existing, [
      { header: 'Campaña', accessor: (r: any) => r.campaign },
      { header: 'Tipo', accessor: (r: any) => r.tipoCurso },
      { header: 'Salón', accessor: (r: any) => r.salon || '' },
      { header: 'Guía', accessor: (r: any) => guiaNombre(r.guia) },
      { header: 'Horario', accessor: (r: any) => r.horarioCurso },
      { header: 'Inicio campaña', accessor: (r: any) => (r.inicioCampania ? String(r.inicioCampania).slice(0, 10) : '') },
      { header: 'Final campaña', accessor: (r: any) => (r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '') },
      { header: 'Inicio curso', accessor: (r: any) => (r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '') },
      { header: 'Duración (meses)', accessor: (r: any) => r.duracionCurso ?? '' },
      { header: 'Final curso', accessor: (r: any) => (r.finalCurso ? String(r.finalCurso).slice(0, 10) : '') },
      { header: 'Cupos', accessor: (r: any) => r.numeroUsuarios ?? 0 },
      { header: 'Inscritos', accessor: (r: any) => r.usuInscritos ?? 0 },
    ], `campanas_${new Date().toISOString().slice(0, 10)}`)
  }

  // --- Edición de cursos guardados ---
  const editFinalCurso = editRow && editRow.inicioCurso && editRow.duracionCurso > 0
    ? addMonths(editRow.inicioCurso, editRow.duracionCurso + 1) : ''

  const openEdit = (r: any) => { setEditMsg(null); setEditRow({
    ...r,
    salon: r.salon || '',
    inicioCurso: r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '',
    inicioCampania: r.inicioCampania ? String(r.inicioCampania).slice(0, 10) : '',
    finalCampaign: r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '',
    duracionCurso: r.duracionCurso || 0,
    numeroUsuarios: r.numeroUsuarios || 0,
    activa: r.activa !== false,
  }) }

  const saveEdit = async () => {
    if (!editRow) return
    setRowBusy(true); setEditMsg(null)
    try {
      const res = await fetch(`/api/postgres/campaigns/${editRow._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipoCurso: editRow.tipoCurso, salon: editRow.salon, guia: editRow.guia || null, horarioCurso: editRow.horarioCurso,
          inicioCurso: editRow.inicioCurso || null, duracionCurso: editRow.duracionCurso,
          numeroUsuarios: editRow.numeroUsuarios, inicioCampania: editRow.inicioCampania || null,
          finalCampaign: editRow.finalCampaign || null, activa: editRow.activa,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error al editar el curso')
      setEditRow(null); setMsg({ type: 'ok', text: 'Curso actualizado.' }); loadExisting()
    } catch (e: any) { setEditMsg(e.message) } finally { setRowBusy(false) }
  }

  // Agregar curso(s) a una campaña existente: precarga nombre + fechas en el
  // formulario de arriba; el upsert del POST suma los cursos nuevos a esa campaña.
  const addCursoToCampaign = (r: any) => {
    setCampaign(r.campaign)
    setInicioCampania(r.inicioCampania ? String(r.inicioCampania).slice(0, 10) : '')
    setFinalCampaign(r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '')
    setCursos([]); setForm(EMPTY); setEditIndex(null)
    setMsg({ type: 'ok', text: `Agregando cursos a "${r.campaign}". Agrega el/los curso(s) abajo y pulsa "Crear Campaña" (se suman a la campaña).` })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const doDelete = async () => {
    if (!deleting) return
    setRowBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/postgres/campaigns/${deleting._id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Error al eliminar el curso')
      setDeleting(null); setMsg({ type: 'ok', text: 'Curso eliminado.' }); loadExisting()
    } catch (e: any) { setMsg({ type: 'err', text: e.message }) } finally { setRowBusy(false) }
  }

  const horariosOpts = horariosFor(form.tipoCurso)
  const editing = editIndex !== null

  // --- Reporte: estado de cada curso por fecha + filtros ---
  const todayStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  // Finalizada si la última fecha del curso (final curso, o cierre de matrícula
  // si no hay final curso) ya pasó respecto a hoy; si no, En progreso.
  const rowEstado = (r: any): 'finalizada' | 'progreso' => {
    const end = (r.finalCurso ? String(r.finalCurso).slice(0, 10) : '') || (r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '')
    return end && end < todayStr ? 'finalizada' : 'progreso'
  }
  const reporteRows = existing.filter((r: any) => {
    if (applied.nombre.trim() && !String(r.campaign || '').toLowerCase().includes(applied.nombre.trim().toLowerCase())) return false
    if (applied.curso && String(r.tipoCurso || '') !== applied.curso) return false
    const ini = r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : ''
    if (applied.desde && (!ini || ini < applied.desde)) return false
    if (applied.hasta && (!ini || ini > applied.hasta)) return false
    if (applied.estado !== 'todos' && rowEstado(r) !== applied.estado) return false
    return true
  })

  const handleReporteCSV = () => {
    exportToExcel(reporteRows, [
      { header: 'Campaña', accessor: (r: any) => r.campaign },
      { header: 'Tipo', accessor: (r: any) => r.tipoCurso },
      { header: 'Salón', accessor: (r: any) => r.salon || '' },
      { header: 'Guía', accessor: (r: any) => guiaNombre(r.guia) },
      { header: 'Horario', accessor: (r: any) => r.horarioCurso },
      { header: 'Inicio curso', accessor: (r: any) => (r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '') },
      { header: 'Final curso', accessor: (r: any) => (r.finalCurso ? String(r.finalCurso).slice(0, 10) : '') },
      { header: 'Cierre matríc.', accessor: (r: any) => (r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '') },
      { header: 'Cupos', accessor: (r: any) => `${r.usuInscritos ?? 0}/${r.numeroUsuarios ?? 0}` },
      { header: 'Estado', accessor: (r: any) => (rowEstado(r) === 'finalizada' ? 'Finalizada' : 'En progreso') },
    ], `reporte_campanas_${todayStr}`)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Campañas</h1>
        <p className="mt-2 text-gray-600">Crea campañas con sus cursos. Estos cursos alimentan el wizard de Crear Contrato.</p>
      </div>

      {/* Pestañas */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {([['gestion', 'Gestión'], ['reporte', 'Reporte']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {msg && (
        <div className={`p-3 rounded-md text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      {activeTab === 'gestion' && (<>

      {/* Datos de la campaña */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Datos de la campaña</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={lblCls}>Nombre de la campaña *</label>
            <input type="text" value={campaign} onChange={e => setCampaign(e.target.value)} className={inputCls} placeholder="Ej. VERANO2026" />
          </div>
          <div>
            <label className={lblCls}>Inicio de campaña (apertura de matrícula)</label>
            <input type="date" value={inicioCampania} onChange={e => setInicioCampania(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={lblCls}>Final campaña (cierre de matrícula)</label>
            <input type="date" value={finalCampaign} onChange={e => setFinalCampaign(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Agregar / editar curso */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{editing ? `Editar curso #${editIndex! + 1}` : 'Agregar curso'}</h2>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className={lblCls}>Tipo de curso *</label>
            <select value={form.tipoCurso} onChange={e => setForm({ ...form, tipoCurso: e.target.value, horarioCurso: '' })} className={inputCls} title="Tipo de curso">
              <option value="">Seleccionar...</option>
              {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}{esMenores(t) ? ' (menores)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>Salón</label>
            <input type="text" value={form.salon} onChange={e => setForm({ ...form, salon: e.target.value })} className={inputCls} placeholder="Ej. Salón A / Aula 3" />
          </div>
          <div>
            <label className={lblCls}>Guía</label>
            <select value={form.guia} onChange={e => setForm({ ...form, guia: e.target.value })} className={inputCls} title="Guía del curso">
              <option value="">Seleccionar...</option>
              {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>Horario *</label>
            <select value={form.horarioCurso} disabled={!form.tipoCurso} onChange={e => setForm({ ...form, horarioCurso: e.target.value })} className={inputCls} title="Horario">
              <option value="">Seleccionar...</option>
              {horariosOpts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4">
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
        <div className="mt-4 flex justify-end gap-2">
          {editing && (
            <button type="button" onClick={cancelEdit} className="px-3 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
              Cancelar edición
            </button>
          )}
          <button type="button" onClick={requestAdd}
            className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
            <PlusIcon className="h-4 w-4 mr-1" /> {editing ? 'Guardar cambios' : 'Agregar Curso'}
          </button>
        </div>
      </div>

      {/* Cursos agregados */}
      {cursos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Cursos de la campaña ({cursos.length})</h2>
          <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2">Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio</th><th>Duración</th><th>Final</th><th>Cupos</th><th aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              {cursos.map((c, i) => (
                <tr key={i} className={`border-b last:border-0 ${editIndex === i ? 'bg-primary-50' : ''}`}>
                  <td className="py-2 font-medium">{c.tipoCurso}</td>
                  <td>{c.salon || '—'}</td>
                  <td>{guiaNombre(c.guia)}</td>
                  <td>{c.horarioCurso}</td>
                  <td>{c.inicioCurso}</td>
                  <td>{c.duracionCurso} mes(es)</td>
                  <td>{c.finalCurso || '—'}</td>
                  <td>{c.numeroUsuarios}</td>
                  <td className="text-right whitespace-nowrap">
                    <button type="button" onClick={() => editCurso(i)} className="text-primary-600 hover:text-primary-700 mr-2" title="Editar curso">
                      <PencilSquareIcon className="h-5 w-5 inline" />
                    </button>
                    <button type="button" onClick={() => removeCurso(i)} className="text-red-600 hover:text-red-700" title="Quitar curso">
                      <TrashIcon className="h-5 w-5 inline" />
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Campañas existentes</h2>
          {existing.length > 0 && (
            <button type="button" onClick={handleCSV}
              className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
              <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
            </button>
          )}
        </div>
        {existing.length === 0 ? (
          <p className="text-gray-500 text-sm">Aún no hay cursos/campañas creados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Campaña</th><th>Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th><th>Cupos</th><th>Estado</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {existing.map((r: any) => {
                  const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                  const finalizada = rowEstado(r) === 'finalizada'
                  return (
                    <tr key={r._id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.campaign}</td>
                      <td>{r.tipoCurso}</td>
                      <td>{r.salon || '—'}</td>
                      <td>{guiaNombre(r.guia)}</td>
                      <td>{r.horarioCurso}</td>
                      <td>{r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '—'}</td>
                      <td>{r.finalCurso ? String(r.finalCurso).slice(0, 10) : '—'}</td>
                      <td>{r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '—'}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${full ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${finalizada ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {finalizada ? 'Finalizada' : 'En progreso'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <button type="button" onClick={() => addCursoToCampaign(r)} className="text-accent-600 hover:text-accent-700 mr-2 text-xs font-semibold" title="Agregar curso a esta campaña">
                          + curso
                        </button>
                        <button type="button" onClick={() => openEdit(r)} className="text-primary-600 hover:text-primary-700 mr-2" title="Editar curso">
                          <PencilSquareIcon className="h-5 w-5 inline" />
                        </button>
                        <button type="button" onClick={() => setDeleting(r)} className="text-red-600 hover:text-red-700" title="Eliminar curso">
                          <TrashIcon className="h-5 w-5 inline" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>)}

      {activeTab === 'reporte' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          {/* Filtros */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <div>
              <label className={lblCls}>Nombre campaña</label>
              <input type="text" value={repNombre} onChange={e => setRepNombre(e.target.value)} className={inputCls} placeholder="Buscar..." />
            </div>
            <div>
              <label className={lblCls}>Curso</label>
              <select value={repCurso} onChange={e => setRepCurso(e.target.value)} className={inputCls} title="Filtrar por tipo de curso">
                <option value="">Todos</option>
                {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lblCls}>Fecha inicial (inicio curso ≥)</label>
              <input type="date" value={repDesde} onChange={e => setRepDesde(e.target.value)} className={inputCls} title="Inicio de curso desde" />
            </div>
            <div>
              <label className={lblCls}>Fecha final (inicio curso ≤)</label>
              <input type="date" value={repHasta} onChange={e => setRepHasta(e.target.value)} className={inputCls} title="Inicio de curso hasta" />
            </div>
            <div>
              <label className={lblCls}>Estado</label>
              <select value={repEstado} onChange={e => setRepEstado(e.target.value as any)} className={inputCls} title="Filtrar por estado">
                <option value="todos">Todos</option>
                <option value="finalizada">Finalizada</option>
                <option value="progreso">En progreso</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={aplicarFiltros}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
                Aplicar filtros
              </button>
              <button type="button" onClick={limpiarFiltros}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                Limpiar filtros
              </button>
              <p className="ml-2 text-sm text-gray-500">{reporteRows.length} curso(s)</p>
            </div>
            {reporteRows.length > 0 && (
              <button type="button" onClick={handleReporteCSV}
                className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border border-green-200 bg-green-100 text-green-700 hover:bg-green-200">
                <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
              </button>
            )}
          </div>

          {reporteRows.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay cursos que coincidan con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Campaña</th><th>Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th><th>Cupos</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {reporteRows.map((r: any) => {
                    const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                    const finalizada = rowEstado(r) === 'finalizada'
                    return (
                      <tr key={r._id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.campaign}</td>
                        <td>{r.tipoCurso}</td>
                        <td>{r.salon || '—'}</td>
                        <td>{guiaNombre(r.guia)}</td>
                        <td>{r.horarioCurso}</td>
                        <td>{r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCurso ? String(r.finalCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '—'}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${full ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                            {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                          </span>
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${finalizada ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                            {finalizada ? 'Finalizada' : 'En progreso'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación al agregar/editar curso */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">{editing ? 'Confirmar cambios del curso' : 'Confirmar curso'}</h3>
            <div className="text-sm text-gray-700 space-y-1 mb-5">
              <p><b>Tipo:</b> {form.tipoCurso}{esMenores(form.tipoCurso) ? ' (menores)' : ''}</p>
              <p><b>Salón:</b> {form.salon || '—'}</p>
              <p><b>Guía:</b> {guiaNombre(form.guia)}</p>
              <p><b>Horario:</b> {form.horarioCurso}</p>
              <p><b>Inicio:</b> {form.inicioCurso} · <b>Duración:</b> {form.duracionCurso} mes(es)</p>
              <p><b>Final:</b> {finalCurso || '—'}</p>
              <p><b>Cupos:</b> {form.numeroUsuarios}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={confirmAdd} className="px-4 py-2 text-sm rounded-md text-white bg-primary-600 hover:bg-primary-700">{editing ? 'Guardar cambios' : 'Confirmar y agregar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: editar curso guardado */}
      {editRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Editar curso — {editRow.campaign}</h3>
            <p className="text-xs text-gray-500 mb-4">Inscritos actuales: {editRow.usuInscritos ?? 0}</p>
            {editMsg && (
              <div className="mb-4 p-2.5 rounded-md text-sm bg-red-50 border border-red-200 text-red-700">{editMsg}</div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={lblCls}>Tipo de curso *</label>
                <select value={editRow.tipoCurso} onChange={e => setEditRow({ ...editRow, tipoCurso: e.target.value, horarioCurso: '' })} className={inputCls}>
                  {TIPOS_CURSO.map(t => <option key={t} value={t}>{t}{esMenores(t) ? ' (menores)' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className={lblCls}>Salón</label>
                <input type="text" value={editRow.salon} onChange={e => setEditRow({ ...editRow, salon: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={lblCls}>Guía</label>
                <select value={editRow.guia || ''} onChange={e => setEditRow({ ...editRow, guia: e.target.value })} className={inputCls} title="Guía del curso">
                  <option value="">Seleccionar...</option>
                  {guias.map(g => <option key={g._id} value={g._id}>{g.nombreCompleto}</option>)}
                </select>
              </div>
              <div>
                <label className={lblCls}>Horario *</label>
                <select value={editRow.horarioCurso} onChange={e => setEditRow({ ...editRow, horarioCurso: e.target.value })} className={inputCls}>
                  <option value="">Seleccionar...</option>
                  {(editRow.horarioCurso && !horariosFor(editRow.tipoCurso).includes(editRow.horarioCurso)
                    ? [editRow.horarioCurso, ...horariosFor(editRow.tipoCurso)]
                    : horariosFor(editRow.tipoCurso)
                  ).map(h => <option key={h} value={h}>{h}{editRow.horarioCurso === h && !horariosFor(editRow.tipoCurso).includes(h) ? ' (actual)' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className={lblCls}>N° de usuarios (cupos) *</label>
                <input type="number" min={1} value={editRow.numeroUsuarios || ''} onChange={e => setEditRow({ ...editRow, numeroUsuarios: parseInt(e.target.value || '0', 10) || 0 })} className={inputCls} />
              </div>
              <div>
                <label className={lblCls}>Inicio del curso</label>
                <input type="date" value={editRow.inicioCurso} onChange={e => setEditRow({ ...editRow, inicioCurso: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={lblCls}>Duración (meses)</label>
                <input type="number" min={1} value={editRow.duracionCurso || ''} onChange={e => setEditRow({ ...editRow, duracionCurso: parseInt(e.target.value || '0', 10) || 0 })} className={inputCls} />
              </div>
              <div>
                <label className={lblCls}>Final del curso (calculado)</label>
                <input type="text" value={editFinalCurso} disabled className={inputCls} placeholder="—" />
              </div>
              <div>
                <label className={lblCls}>Inicio campaña</label>
                <input type="date" value={editRow.inicioCampania} onChange={e => setEditRow({ ...editRow, inicioCampania: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={lblCls}>Cierre matrícula</label>
                <input type="date" value={editRow.finalCampaign} onChange={e => setEditRow({ ...editRow, finalCampaign: e.target.value })} className={inputCls} />
              </div>
            </div>
            <label className="inline-flex items-center mt-4 cursor-pointer">
              <input type="checkbox" checked={editRow.activa} onChange={e => setEditRow({ ...editRow, activa: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <span className="ml-2 text-sm text-gray-700">Activa (visible en el wizard de contratos)</span>
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setEditRow(null)} className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={saveEdit} disabled={rowBusy} className="px-4 py-2 text-sm rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                {rowBusy ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: eliminar curso guardado */}
      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Eliminar curso</h3>
            <p className="text-sm text-gray-600 mb-5">
              ¿Eliminar el curso <b>{deleting.tipoCurso} · {deleting.horarioCurso}</b> de la campaña <b>{deleting.campaign}</b>?
              {(deleting.usuInscritos ?? 0) > 0 && <span className="block mt-2 text-red-600">⚠️ Tiene {deleting.usuInscritos} inscrito(s). Ya no aparecerá en el wizard.</span>}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={doDelete} disabled={rowBusy} className="px-4 py-2 text-sm rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {rowBusy ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
