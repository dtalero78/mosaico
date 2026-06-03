'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import {
  CalendarIcon, PlusIcon, TrashIcon, ArrowPathIcon,
  XMarkIcon, ExclamationTriangleIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { ADMIN_EVENT_TIPOS, ADMIN_EVENT_TIPO_META, type AdminEventTipo } from '@/lib/admin-event-window'

interface AdvisorOption { _id: string; nombre: string }

interface Item {
  _id: string
  eventGroupId: string
  advisorId: string
  advisorNombre: string | null
  tipo: AdminEventTipo
  titulo: string | null
  descripcion: string | null
  fechaInicio: string
  horas: number
  registrado: boolean
  fechaRegistro: string | null
  timeout: string | null
  motivoCierre: string | null
  createdBy: string | null
  _createdDate: string
}

interface ConflictDetail {
  source: 'CALENDARIO' | 'ADMIN_EVENTS'
  advisorId: string
  advisorNombre: string | null
  eventoId: string
  fecha: string
  tipo: string | null
  descripcion: string | null
}

const PAD = (n: number) => String(n).padStart(2, '0')
const yesterdayLocal = () => {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`
}
const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`
}
const oneMonthAhead = () => {
  const d = new Date(); d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('es', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return '—' }
}

export default function EventosAdministrativosPage() {
  // Filtros lista
  const [startDate, setStartDate] = useState(yesterdayLocal())
  const [endDate, setEndDate]     = useState(oneMonthAhead())
  const [filterAdvisor, setFilterAdvisor] = useState('')
  const [filterTipo, setFilterTipo] = useState<string>('')

  // Advisors
  const [advisors, setAdvisors] = useState<AdvisorOption[]>([])
  const [advisorsLoading, setAdvisorsLoading] = useState(true)

  // Lista
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal crear
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    tipo: 'TRAINING' as AdminEventTipo,
    titulo: '',
    descripcion: '',
    fecha: todayLocal(),
    hora: '09:00',
    horas: 1,
    asignarTodos: false,
    advisorIds: [] as string[],
  })
  const [submitting, setSubmitting] = useState(false)
  const [conflicts, setConflicts] = useState<ConflictDetail[]>([])
  const [conflictsChecking, setConflictsChecking] = useState(false)
  const [conflictsChecked, setConflictsChecked] = useState(false)

  // Eliminar
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'one' | 'group'; item: Item } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Cargar advisors
  useEffect(() => {
    fetch('/api/postgres/advisors')
      .then(r => r.json())
      .then(j => {
        const list = (j.advisors || j.data || j.items || []) as any[]
        setAdvisors(list
          .filter(a => a.activo !== false)
          .map(a => ({
            _id: a._id,
            nombre: a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim() || a.email || a._id,
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
      })
      .catch(() => setAdvisors([]))
      .finally(() => setAdvisorsLoading(false))
  }, [])

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({
        startDate: `${startDate}T00:00:00`,
        endDate:   `${endDate}T23:59:59`,
      })
      if (filterAdvisor) qs.set('advisorId', filterAdvisor)
      if (filterTipo)    qs.set('tipo', filterTipo)
      const r = await fetch(`/api/postgres/admin-events?${qs}`)
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      setItems(j.items)
    } catch (e: any) {
      setError(e?.message || 'Error al cargar'); setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Resetea estado del modal
  const openCreate = () => {
    setForm({
      tipo: 'TRAINING', titulo: '', descripcion: '',
      fecha: todayLocal(), hora: '09:00', horas: 1,
      asignarTodos: false, advisorIds: [],
    })
    setConflicts([]); setConflictsChecked(false)
    setCreating(true)
  }
  const closeCreate = () => { if (!submitting) setCreating(false) }

  const targetAdvisorIds = useMemo(() => {
    if (form.asignarTodos) return advisors.map(a => a._id)
    return form.advisorIds
  }, [form.asignarTodos, form.advisorIds, advisors])

  const fechaInicioISO = useMemo(() => {
    if (!form.fecha || !form.hora) return ''
    return new Date(`${form.fecha}T${form.hora}:00`).toISOString()
  }, [form.fecha, form.hora])

  const handleCheckConflicts = async () => {
    if (targetAdvisorIds.length === 0) {
      toast.error('Selecciona al menos un advisor'); return
    }
    if (!fechaInicioISO) { toast.error('Fecha/hora inválida'); return }
    setConflictsChecking(true)
    try {
      const r = await fetch('/api/postgres/admin-events/check-conflict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advisorIds: targetAdvisorIds, fechaInicio: fechaInicioISO, horas: form.horas }),
      })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      setConflicts(j.conflicts as ConflictDetail[])
      setConflictsChecked(true)
      if (j.conflicts.length === 0) {
        toast.success('Sin conflictos — puedes crear el evento')
      } else {
        toast.error(`${j.conflicts.length} conflicto(s) detectados`)
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error verificando conflictos')
    } finally {
      setConflictsChecking(false)
    }
  }

  const handleCreate = async () => {
    if (conflicts.length > 0) {
      toast.error('Hay conflictos sin resolver')
      return
    }
    if (!conflictsChecked) {
      toast.error('Verifica conflictos antes de crear')
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch('/api/postgres/admin-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advisorIds: targetAdvisorIds,
          tipo: form.tipo,
          titulo: form.titulo.trim() || null,
          descripcion: form.descripcion.trim() || null,
          fechaInicio: fechaInicioISO,
          horas: form.horas,
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.success) {
        if (j?.detail && Array.isArray(j.detail)) {
          setConflicts(j.detail)
          throw new Error(j.error || 'Conflictos detectados')
        }
        throw new Error(j?.error || `Error ${r.status}`)
      }
      toast.success(`${j.count} evento(s) creado(s)`)
      setCreating(false)
      load()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const url = deleteTarget.kind === 'group'
        ? `/api/postgres/admin-events/group/${deleteTarget.item.eventGroupId}`
        : `/api/postgres/admin-events/${deleteTarget.item._id}`
      const r = await fetch(url, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      toast.success(`Eliminado(s) ${j.deleted}`)
      setDeleteTarget(null); load()
    } catch (e: any) {
      toast.error(e?.message || 'Error al eliminar')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.ADMIN_EVENTS_GESTIONAR}>
        <div className="space-y-4 pb-10">
          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-violet-100 rounded-full flex-shrink-0">
                <CalendarIcon className="h-7 w-7 text-violet-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Eventos Administrativos</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  Crear y gestionar horas administrativas del advisor: Training, Support, Observation,
                  Meeting, Development. Bloquea si hay conflicto con sesiones académicas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-semibold"
            >
              <PlusIcon className="h-5 w-5" />
              Crear Evento Administrativo
            </button>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label htmlFor="f-start" className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
                <input id="f-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="f-end" className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
                <input id="f-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="f-adv" className="block text-xs font-medium text-gray-600 mb-1">Advisor</label>
                <select id="f-adv" value={filterAdvisor} onChange={e => setFilterAdvisor(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" disabled={advisorsLoading}>
                  <option value="">Todos</option>
                  {advisors.map(a => <option key={a._id} value={a._id}>{a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="f-tipo" className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select id="f-tipo" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Todos</option>
                  {ADMIN_EVENT_TIPOS.map(t => (
                    <option key={t} value={t}>{ADMIN_EVENT_TIPO_META[t].label}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={load} disabled={loading}
                className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                <ArrowPathIcon className="h-4 w-4" />
                {loading ? 'Cargando…' : 'Buscar'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">{error}</div>
          )}

          {/* Tabla */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
            ) : items.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">
                Sin eventos administrativos en el rango. Crea el primero con el botón superior.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-xs text-gray-500 uppercase">
                    <th className="text-left font-medium px-3 py-2">Fecha · Hora</th>
                    <th className="text-left font-medium px-3 py-2 w-32">Tipo</th>
                    <th className="text-left font-medium px-3 py-2">Título / Advisor</th>
                    <th className="text-center font-medium px-3 py-2 w-20">Horas</th>
                    <th className="text-center font-medium px-3 py-2 w-32">Estado</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const meta = ADMIN_EVENT_TIPO_META[it.tipo]
                    return (
                      <tr key={it._id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-900 font-mono">{fechaCorta(it.fechaInicio)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${meta.color} ${meta.textColor} border`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-gray-900">{it.titulo || '—'}</div>
                          <div className="text-xs text-gray-500">{it.advisorNombre || it.advisorId}</div>
                        </td>
                        <td className="px-3 py-2 text-center text-sm font-semibold text-gray-700">{it.horas}h</td>
                        <td className="px-3 py-2 text-center">
                          {it.registrado ? (
                            it.motivoCierre === 'GESTION_COORDINADOR' ? (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                                ✓ Por Coordinación
                              </span>
                            ) : (
                              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                                ✓ Registrado
                              </span>
                            )
                          ) : (
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                              Pendiente
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-1">
                            {!it.registrado && (
                              <button type="button"
                                onClick={() => setDeleteTarget({ kind: 'one', item: it })}
                                title="Eliminar solo este advisor"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            )}
                            {!it.registrado && (
                              <button type="button"
                                onClick={() => setDeleteTarget({ kind: 'group', item: it })}
                                title="Eliminar grupo entero"
                                className="px-2 py-1 text-[10px] text-gray-600 border border-gray-300 rounded hover:bg-gray-100">
                                Grupo
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Modal Crear */}
        {creating && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black bg-opacity-60 overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl my-8">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Crear Evento Administrativo</h2>
                <button type="button" onClick={closeCreate} disabled={submitting}
                  className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Tipo */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tipo *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {ADMIN_EVENT_TIPOS.map(t => {
                      const meta = ADMIN_EVENT_TIPO_META[t]
                      const sel = form.tipo === t
                      return (
                        <button key={t} type="button"
                          onClick={() => setForm(f => ({ ...f, tipo: t }))}
                          className={`px-3 py-2 text-sm rounded-lg border-2 font-medium ${
                            sel ? `${meta.color} ${meta.textColor}` : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}>
                          {meta.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Fecha + hora + duración */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="fecha" className="block text-xs font-medium text-gray-700 mb-1">Fecha *</label>
                    <input id="fecha" type="date" value={form.fecha}
                      onChange={e => { setForm(f => ({ ...f, fecha: e.target.value })); setConflictsChecked(false) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="hora" className="block text-xs font-medium text-gray-700 mb-1">Hora inicio *</label>
                    <input id="hora" type="time" value={form.hora}
                      onChange={e => { setForm(f => ({ ...f, hora: e.target.value })); setConflictsChecked(false) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="horas" className="block text-xs font-medium text-gray-700 mb-1">Duración (h) *</label>
                    <select id="horas" value={form.horas}
                      onChange={e => { setForm(f => ({ ...f, horas: Number(e.target.value) })); setConflictsChecked(false) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(h => <option key={h} value={h}>{h} hora{h > 1 ? 's' : ''}</option>)}
                    </select>
                  </div>
                </div>

                {/* Título + descripción */}
                <div>
                  <label htmlFor="titulo" className="block text-xs font-medium text-gray-700 mb-1">Título (opcional)</label>
                  <input id="titulo" type="text" value={form.titulo} maxLength={200}
                    onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                    placeholder="Ej: Sync semanal · Capacitación nuevos métodos"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="desc" className="block text-xs font-medium text-gray-700 mb-1">Descripción (opcional)</label>
                  <textarea id="desc" rows={2} value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>

                {/* Asignación */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Asignar a *</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" checked={form.asignarTodos}
                        onChange={() => { setForm(f => ({ ...f, asignarTodos: true })); setConflictsChecked(false) }} />
                      Todos los advisors activos ({advisors.length})
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" checked={!form.asignarTodos}
                        onChange={() => { setForm(f => ({ ...f, asignarTodos: false })); setConflictsChecked(false) }} />
                      Seleccionar advisors específicos
                    </label>
                    {!form.asignarTodos && (
                      <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-gray-50">
                        {advisorsLoading ? <p className="text-sm text-gray-400">Cargando…</p> : advisors.map(a => {
                          const sel = form.advisorIds.includes(a._id)
                          return (
                            <label key={a._id} className="flex items-center gap-2 text-sm hover:bg-white px-2 py-1 rounded cursor-pointer">
                              <input type="checkbox" checked={sel}
                                onChange={() => {
                                  setForm(f => ({
                                    ...f,
                                    advisorIds: sel
                                      ? f.advisorIds.filter(id => id !== a._id)
                                      : [...f.advisorIds, a._id],
                                  }))
                                  setConflictsChecked(false)
                                }} />
                              {a.nombre}
                            </label>
                          )
                        })}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-500">
                      {targetAdvisorIds.length} advisor{targetAdvisorIds.length !== 1 ? 's' : ''} seleccionado{targetAdvisorIds.length !== 1 ? 's' : ''}.
                    </p>
                  </div>
                </div>

                {/* Conflictos */}
                {conflicts.length > 0 && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <ExclamationTriangleIcon className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <p className="text-sm font-semibold text-red-900">
                        {conflicts.length} conflicto(s) detectados — el académico prima, resuélvelos antes de crear:
                      </p>
                    </div>
                    <ul className="space-y-1 text-xs text-red-800 max-h-40 overflow-y-auto">
                      {conflicts.map((c, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className={`px-1.5 rounded text-[10px] font-medium ${
                            c.source === 'CALENDARIO' ? 'bg-blue-200 text-blue-900' : 'bg-violet-200 text-violet-900'
                          }`}>{c.source === 'CALENDARIO' ? 'Académico' : 'Admin'}</span>
                          <span>{c.advisorNombre || c.advisorId}</span>
                          <span>·</span>
                          <span className="font-mono">{fechaCorta(c.fecha)}</span>
                          {c.descripcion && <span>· {c.descripcion}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {conflictsChecked && conflicts.length === 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    <p className="text-sm text-emerald-800">Sin conflictos — listo para crear.</p>
                  </div>
                )}
              </div>

              {/* Acciones modal */}
              <div className="mt-5 flex justify-between items-center gap-2 pt-3 border-t border-gray-100">
                <button type="button"
                  onClick={handleCheckConflicts}
                  disabled={submitting || conflictsChecking || targetAdvisorIds.length === 0}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {conflictsChecking ? 'Verificando…' : '🔍 Verificar conflictos'}
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={closeCreate} disabled={submitting}
                    className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleCreate}
                    disabled={submitting || !conflictsChecked || conflicts.length > 0}
                    title={!conflictsChecked ? 'Verifica conflictos primero' : conflicts.length > 0 ? 'Resuelve los conflictos' : ''}
                    className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {submitting ? 'Creando…' : `✓ Crear ${targetAdvisorIds.length} evento(s)`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Eliminar */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {deleteTarget.kind === 'group' ? 'Eliminar grupo entero' : 'Eliminar este advisor'}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {deleteTarget.kind === 'group'
                  ? `Se eliminarán TODAS las filas del grupo (todos los advisors asignados al mismo evento de ${ADMIN_EVENT_TIPO_META[deleteTarget.item.tipo].label}).`
                  : `Se eliminará solo la fila de ${deleteTarget.item.advisorNombre || deleteTarget.item.advisorId}. El resto del grupo permanece.`
                }
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting}
                  className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="button" onClick={handleDelete} disabled={deleting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
