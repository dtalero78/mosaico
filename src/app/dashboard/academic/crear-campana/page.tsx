'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import { TIPOS_CURSO, horariosFor, esMenores, addMonths, campaignNameToDate } from '@/lib/cursos-campaign'
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
  // Gestión: campaña seleccionada en el dropdown ('' | '__NEW__' | nombre) + modal de curso
  const [gestionSel, setGestionSel] = useState('')
  const [showCursoModal, setShowCursoModal] = useState(false)
  const [cursoMode, setCursoMode] = useState<'draft' | 'existing'>('draft')
  // Reporte: campaña cuyo detalle está desplegado (null = mostrar tarjetas)
  const [detalleCampaign, setDetalleCampaign] = useState<string | null>(null)
  // Modal de inscritos (al hacer click en el badge de Cupos)
  const [inscritosCurso, setInscritosCurso] = useState<any>(null)
  const [inscritosList, setInscritosList] = useState<any[] | null>(null)
  const [inscritosLoading, setInscritosLoading] = useState(false)
  // Pestañas + filtros del Reporte (inputs = draft; se aplican con "Aplicar filtros")
  const [activeTab, setActiveTab] = useState<'gestion' | 'reporte'>('gestion')
  const [repNombre, setRepNombre] = useState('')
  const [repCurso, setRepCurso] = useState('')
  const [repDesde, setRepDesde] = useState('')
  const [repHasta, setRepHasta] = useState('')
  const [repEstado, setRepEstado] = useState<'todos' | 'matricula' | 'activo' | 'cerrado'>('todos')

  // Abre el modal con los inscritos (nombre + id) de un curso/salón
  const openInscritos = async (r: any) => {
    setInscritosCurso({ campaign: r.campaign, tipoCurso: r.tipoCurso, salon: r.salon, horarioCurso: r.horarioCurso, inscritos: r.usuInscritos, total: r.numeroUsuarios })
    setInscritosList(null); setInscritosLoading(true)
    try {
      const res = await fetch(`/api/postgres/campaigns/${r._id}/inscritos`, { cache: 'no-store' })
      const d = await res.json()
      setInscritosList((d.data || d).items || [])
    } catch { setInscritosList([]) }
    finally { setInscritosLoading(false) }
  }
  const [applied, setApplied] = useState<{ nombre: string; curso: string; desde: string; hasta: string; estado: 'todos' | 'matricula' | 'activo' | 'cerrado' }>({ nombre: '', curso: '', desde: '', hasta: '', estado: 'todos' })
  const aplicarFiltros = () => setApplied({ nombre: repNombre, curso: repCurso, desde: repDesde, hasta: repHasta, estado: repEstado })
  const limpiarFiltros = () => { setRepNombre(''); setRepCurso(''); setRepDesde(''); setRepHasta(''); setRepEstado('todos'); setApplied({ nombre: '', curso: '', desde: '', hasta: '', estado: 'todos' }) }

  // Campañas únicas para el dropdown, de la más reciente a la más antigua
  // (por la fecha embebida en el nombre, p.ej. AGOSTO172026 → 2026-08-17).
  const campaniasOrdenadas = useMemo(() => {
    const nombres = Array.from(new Set(existing.map((r: any) => r.campaign).filter(Boolean))) as string[]
    return nombres.sort((a, b) => {
      const da = campaignNameToDate(a), db = campaignNameToDate(b)
      if (da && db && da !== db) return db.localeCompare(da) // fecha desc (más reciente primero)
      return b.localeCompare(a)                              // fallback alfabético desc
    })
  }, [existing])

  // Filtro + orden de la tabla "Campañas existentes" (Gestión): campaña de la más
  // nueva a la más vieja por la fecha del nombre; dentro de cada campaña conserva
  // el orden del backend (tipo/salón). El sort es estable → devolver 0 preserva.
  const [gestionFiltro, setGestionFiltro] = useState('')
  const existentesOrdenadas = useMemo(() => {
    const arr = [...existing].sort((a: any, b: any) => {
      const ca = a.campaign || '', cb = b.campaign || ''
      if (ca === cb) return 0
      const da = campaignNameToDate(ca), db = campaignNameToDate(cb)
      if (da && db && da !== db) return db.localeCompare(da)
      return cb.localeCompare(ca)
    })
    return gestionFiltro ? arr.filter((r: any) => r.campaign === gestionFiltro) : arr
  }, [existing, gestionFiltro])

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
  // Estado por fechas: Cerrado (finalCurso < hoy) / En matrícula (cierre de matrícula
  // aún no pasa) / Activo (matrícula cerrada pero curso en progreso).
  const rowEstado = (r: any): 'matricula' | 'activo' | 'cerrado' => {
    const fc = r.finalCurso ? String(r.finalCurso).slice(0, 10) : ''
    const fcamp = r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : ''
    if (fc && fc < todayStr) return 'cerrado'
    if (fcamp && fcamp >= todayStr) return 'matricula'
    return 'activo'
  }
  const ESTADO_META = {
    matricula: { label: 'En matrícula', cls: 'bg-blue-100 text-blue-700' },
    activo:    { label: 'Activo',       cls: 'bg-green-100 text-green-700' },
    cerrado:   { label: 'Cerrado',      cls: 'bg-gray-200 text-gray-700' },
  } as const

  // Agregación por CAMPAÑA (para las tarjetas del Reporte y el detalle en Gestión):
  // cursos, matriculados (Σ inscritos / Σ cupos), cierre de matrícula, cursos por tipo.
  const campaniasAgg = useMemo(() => {
    const map = new Map<string, any>()
    for (const r of existing) {
      const k = r.campaign
      if (!k) continue
      if (!map.has(k)) map.set(k, { campaign: k, rows: [], inscritos: 0, cupos: 0, finalCampaign: r.finalCampaign || null, porTipo: {} as Record<string, number>, maxFinalCurso: '' })
      const g = map.get(k)
      g.rows.push(r)
      g.inscritos += (r.usuInscritos ?? 0)
      g.cupos += (r.numeroUsuarios ?? 0)
      g.porTipo[r.tipoCurso] = (g.porTipo[r.tipoCurso] || 0) + 1
      if (!g.finalCampaign && r.finalCampaign) g.finalCampaign = r.finalCampaign
      const fc = r.finalCurso ? String(r.finalCurso).slice(0, 10) : ''
      if (fc > g.maxFinalCurso) g.maxFinalCurso = fc
    }
    return [...map.values()].sort((a, b) => {
      const da = campaignNameToDate(a.campaign), db = campaignNameToDate(b.campaign)
      if (da && db && da !== db) return db.localeCompare(da)
      return b.campaign.localeCompare(a.campaign)
    })
  }, [existing])

  // Estado agregado de una campaña (mismo criterio que Consulta de Cursos, a nivel campaña).
  const campEstado = (g: any): 'matricula' | 'activo' | 'cerrado' => {
    const fcamp = g.finalCampaign ? String(g.finalCampaign).slice(0, 10) : ''
    if (fcamp && fcamp >= todayStr) return 'matricula'
    if (g.maxFinalCurso && g.maxFinalCurso < todayStr) return 'cerrado'
    return 'activo'
  }
  const cursosDeCampania = (nombre: string) => existing.filter((r: any) => r.campaign === nombre)

  // Abrir el modal "Agregar/Editar curso". mode 'existing' agrega a la campaña
  // seleccionada (POST inmediato); 'draft' arma la lista de una campaña nueva.
  const openCursoModal = (mode: 'draft' | 'existing') => {
    setForm(EMPTY); setEditIndex(null); setMsg(null)
    setCursoMode(mode)
    setShowCursoModal(true)
  }
  // Confirmar el curso del modal.
  const submitCursoModal = async () => {
    if (!canAdd) { setMsg({ type: 'err', text: 'Complete tipo de curso, horario, inicio, duración (meses) y número de usuarios.' }); return }
    const nuevo = { ...form, finalCurso }
    if (cursoMode === 'existing') {
      // Agregar el curso a la campaña seleccionada (upsert), sin tocar los demás.
      setSaving(true); setMsg(null)
      try {
        const g = campaniasAgg.find(x => x.campaign === gestionSel)
        const res = await fetch('/api/postgres/campaigns', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign: gestionSel,
            inicioCampania: g?.rows?.[0]?.inicioCampania ? String(g.rows[0].inicioCampania).slice(0, 10) : null,
            finalCampaign: g?.finalCampaign ? String(g.finalCampaign).slice(0, 10) : null,
            cursos: [nuevo],
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Error al agregar el curso')
        setMsg({ type: 'ok', text: `Curso agregado a "${gestionSel}".` })
        setShowCursoModal(false); setForm(EMPTY); loadExisting()
      } catch (e: any) { setMsg({ type: 'err', text: e.message }) } finally { setSaving(false) }
    } else {
      // Campaña nueva: sumar/editar en la lista draft.
      if (editIndex !== null) setCursos(cursos.map((c, i) => (i === editIndex ? nuevo : c)))
      else setCursos([...cursos, nuevo])
      setForm(EMPTY); setEditIndex(null); setShowCursoModal(false)
    }
  }
  const editCursoDraft = (i: number) => { setForm(cursos[i]); setEditIndex(i); setCursoMode('draft'); setShowCursoModal(true) }
  const reporteRows = existing.filter((r: any) => {
    if (applied.nombre && String(r.campaign || '') !== applied.nombre) return false
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
      { header: 'Estado', accessor: (r: any) => ESTADO_META[rowEstado(r)].label },
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

      {activeTab === 'gestion' && (
      <div className="space-y-6">

        {/* Selector de campaña */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <label className={lblCls}>Nombre de la campaña</label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={gestionSel}
              onChange={e => {
                const v = e.target.value
                setGestionSel(v); setMsg(null)
                if (v === '__NEW__') { setCampaign(''); setInicioCampania(''); setFinalCampaign(''); setCursos([]); setForm(EMPTY); setEditIndex(null) }
              }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[260px] focus:ring-2 focus:ring-primary-500"
              title="Seleccionar campaña"
            >
              <option value="">Selecciona una campaña…</option>
              <option value="__NEW__">➕ Crear campaña</option>
              {campaniasOrdenadas.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {gestionSel && gestionSel !== '__NEW__' && existing.length > 0 && (
              <button type="button" onClick={handleCSV}
                className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
              </button>
            )}
          </div>
        </div>

        {/* CREAR NUEVA CAMPAÑA */}
        {gestionSel === '__NEW__' && (<>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Datos de la campaña</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Cursos de la campaña ({cursos.length})</h2>
              <button type="button" onClick={() => openCursoModal('draft')}
                className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
                <PlusIcon className="h-4 w-4 mr-1" /> Agregar curso
              </button>
            </div>
            {cursos.length === 0 ? (
              <p className="text-gray-500 text-sm">Aún no has agregado cursos. Pulsa «Agregar curso».</p>
            ) : (
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
                        <button type="button" onClick={() => editCursoDraft(i)} className="text-primary-600 hover:text-primary-700 mr-2" title="Editar curso">
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
            )}
            {cursos.length > 0 && (
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={submit} disabled={saving}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-accent-600 hover:bg-accent-700 disabled:opacity-50">
                  {saving ? 'Guardando...' : 'Crear Campaña'}
                </button>
              </div>
            )}
          </div>
        </>)}

        {/* CAMPAÑA EXISTENTE SELECCIONADA */}
        {gestionSel && gestionSel !== '__NEW__' && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Cursos de {gestionSel} ({cursosDeCampania(gestionSel).length})</h2>
              <button type="button" onClick={() => openCursoModal('existing')}
                className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700">
                <PlusIcon className="h-4 w-4 mr-1" /> Agregar curso
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th><th>Cupos</th><th>Estado</th><th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {cursosDeCampania(gestionSel).map((r: any) => {
                    const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                    const est = rowEstado(r)
                    return (
                      <tr key={r._id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.tipoCurso}</td>
                        <td>{r.salon || '—'}</td>
                        <td>{guiaNombre(r.guia)}</td>
                        <td>{r.horarioCurso}</td>
                        <td>{r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCurso ? String(r.finalCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '—'}</td>
                        <td>
                          <button type="button" onClick={() => openInscritos(r)} title="Ver inscritos (nombre e ID)"
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:ring-2 hover:ring-offset-1 transition ${full ? 'bg-yellow-100 text-yellow-700 hover:ring-yellow-300' : 'bg-green-100 text-green-700 hover:ring-green-300'}`}>
                            {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                          </button>
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_META[est].cls}`}>
                            {ESTADO_META[est].label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
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
          </div>
        )}

        {!gestionSel && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-sm text-center text-gray-500 text-sm">
            Selecciona una campaña para ver y editar sus cursos, o elige «➕ Crear campaña».
          </div>
        )}
      </div>
      )}

      {activeTab === 'reporte' && (
        detalleCampaign ? (
          /* DETALLE de una campaña (tabla) */
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <button type="button" onClick={() => setDetalleCampaign(null)}
                  className="text-sm text-primary-600 hover:text-primary-800 mb-1">← Volver a las tarjetas</button>
                <h2 className="text-lg font-semibold">{detalleCampaign} · {cursosDeCampania(detalleCampaign).length} curso(s)</h2>
              </div>
              <button type="button" onClick={() => exportToExcel(cursosDeCampania(detalleCampaign), [
                { header: 'Campaña', accessor: (r: any) => r.campaign },
                { header: 'Tipo', accessor: (r: any) => r.tipoCurso },
                { header: 'Salón', accessor: (r: any) => r.salon || '' },
                { header: 'Guía', accessor: (r: any) => guiaNombre(r.guia) },
                { header: 'Horario', accessor: (r: any) => r.horarioCurso },
                { header: 'Inicio curso', accessor: (r: any) => (r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '') },
                { header: 'Final curso', accessor: (r: any) => (r.finalCurso ? String(r.finalCurso).slice(0, 10) : '') },
                { header: 'Cierre matrícula', accessor: (r: any) => (r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '') },
                { header: 'Cupos', accessor: (r: any) => r.numeroUsuarios ?? 0 },
                { header: 'Inscritos', accessor: (r: any) => r.usuInscritos ?? 0 },
                { header: 'Estado', accessor: (r: any) => ESTADO_META[rowEstado(r)].label },
              ], `${detalleCampaign}`)}
                className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border border-green-200 bg-green-100 text-green-700 hover:bg-green-200">
                <ArrowDownTrayIcon className="h-4 w-4 mr-1" /> Descargar CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th><th>Cierre matríc.</th><th>Cupos</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cursosDeCampania(detalleCampaign).map((r: any) => {
                    const full = (r.usuInscritos ?? 0) >= (r.numeroUsuarios ?? 0) && (r.numeroUsuarios ?? 0) > 0
                    const est = rowEstado(r)
                    return (
                      <tr key={r._id} className="border-b last:border-0">
                        <td className="py-2 font-medium">{r.tipoCurso}</td>
                        <td>{r.salon || '—'}</td>
                        <td>{guiaNombre(r.guia)}</td>
                        <td>{r.horarioCurso}</td>
                        <td>{r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCurso ? String(r.finalCurso).slice(0, 10) : '—'}</td>
                        <td>{r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : '—'}</td>
                        <td>
                          <button type="button" onClick={() => openInscritos(r)} title="Ver inscritos (nombre e ID)"
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer hover:ring-2 hover:ring-offset-1 transition ${full ? 'bg-yellow-100 text-yellow-700 hover:ring-yellow-300' : 'bg-green-100 text-green-700 hover:ring-green-300'}`}>
                            {r.usuInscritos ?? 0}/{r.numeroUsuarios ?? 0}
                          </button>
                        </td>
                        <td>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_META[est].cls}`}>
                            {ESTADO_META[est].label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* TARJETAS agrupadas por estado */
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-6">
            {campaniasAgg.length === 0 ? (
              <p className="text-gray-500 text-sm">Aún no hay campañas creadas.</p>
            ) : (
              ([['matricula', 'En matrícula'], ['activo', 'Activas'], ['cerrado', 'Cerradas']] as const).map(([estado, titulo]) => {
                const grupo = campaniasAgg.filter(g => campEstado(g) === estado)
                return (
                  <div key={estado}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${estado === 'matricula' ? 'bg-blue-500' : estado === 'activo' ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <h3 className="text-sm font-semibold text-gray-700">{titulo} ({grupo.length})</h3>
                    </div>
                    {grupo.length === 0 ? (
                      <p className="text-gray-400 text-sm ml-4">Ninguna</p>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {grupo.map(g => (
                          <button
                            key={g.campaign}
                            type="button"
                            onClick={() => setDetalleCampaign(g.campaign)}
                            className={`text-left rounded-lg border p-4 transition-colors hover:shadow-sm ${
                              estado === 'matricula' ? 'bg-blue-50 border-blue-100 hover:border-blue-300'
                              : estado === 'activo' ? 'bg-green-50 border-green-100 hover:border-green-300'
                              : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold text-gray-900 hover:underline">{g.campaign}</div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {g.rows.length} curso(s){g.finalCampaign ? ` · cierre matrícula ${String(g.finalCampaign).slice(0, 10)}` : ''}
                                </div>
                              </div>
                              <div className="text-sm font-semibold text-gray-700 whitespace-nowrap">{g.inscritos}/{g.cupos} <span className="font-normal text-gray-500">matriculados</span></div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {Object.entries(g.porTipo).sort().map(([tipo, n]) => (
                                <span key={tipo} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/70 border border-gray-200 text-gray-700">
                                  {tipo} <span className="ml-1 font-semibold">{n as number}</span>
                                </span>
                              ))}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )
      )}

      {/* Modal: Agregar / Editar curso (formulario) */}
      {showCursoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {editIndex !== null ? 'Editar curso' : 'Agregar curso'}
              {cursoMode === 'existing' && <span className="text-sm font-normal text-gray-500"> — {gestionSel}</span>}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowCursoModal(false); setForm(EMPTY); setEditIndex(null) }} className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={submitCursoModal} disabled={saving || !canAdd}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                <PlusIcon className="h-4 w-4 mr-1" /> {saving ? 'Guardando...' : (editIndex !== null ? 'Guardar cambios' : 'Agregar curso')}
              </button>
            </div>
          </div>
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

      {/* Modal: inscritos de un curso/salón (click en el badge de Cupos) */}
      {inscritosCurso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setInscritosCurso(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Inscritos · {inscritosCurso.tipoCurso} · Salón {inscritosCurso.salon || '—'}
                </h3>
                <p className="text-xs text-gray-500">
                  {inscritosCurso.campaign} · {inscritosCurso.horarioCurso} · {inscritosCurso.inscritos ?? 0}/{inscritosCurso.total ?? 0} cupos
                </p>
              </div>
              <button type="button" onClick={() => setInscritosCurso(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto">
              {inscritosLoading ? (
                <p className="p-5 text-sm text-gray-500">Cargando…</p>
              ) : !inscritosList || inscritosList.length === 0 ? (
                <p className="p-5 text-sm text-gray-500">Sin beneficiarios inscritos en este salón.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 w-8">#</th>
                      <th className="text-left px-4 py-2">Nombre</th>
                      <th className="text-left px-4 py-2">ID</th>
                      <th className="text-left px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inscritosList.map((b: any, i: number) => (
                      <tr key={b.peopleId} className="border-b last:border-0">
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2 text-gray-900">
                          {b.academicaId
                            ? <a href={`/student/${b.academicaId}`} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline">{b.nombre}</a>
                            : b.nombre}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{b.numeroId}</td>
                        <td className="px-4 py-2">
                          {b.inactivo
                            ? <span className="text-xs text-red-600">Inactivo</span>
                            : <span className="text-xs text-emerald-600">{b.aprobacion || 'Activo'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-gray-50 flex justify-end">
              <button type="button" onClick={() => setInscritosCurso(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
