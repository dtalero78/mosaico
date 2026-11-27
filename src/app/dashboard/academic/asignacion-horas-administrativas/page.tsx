'use client'

/**
 * Académico › Sesiones › Asignación Horas Administrativas.
 *
 * Asigna horas administrativas a uno o varios guías en una fecha y horario. Las
 * horas nacen REGISTRADAS: cuentan en Effective y Administrative Hours del
 * Control de Horas sin que el guía haga nada (se suman cuando llega su fecha).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { ClockIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { formatHoras } from '@/lib/event-duration'

interface Guia { _id: string; nombre: string }
interface Asignacion {
  _id: string
  eventGroupId: string
  advisorId: string
  advisorNombre: string | null
  fechaInicio: string
  horas: number
  descripcion: string | null
  createdBy: string | null
  _createdDate: string
}
interface Conflicto { advisorNombre: string | null; advisorId: string; fecha: string; tipo: string | null; descripcion: string | null }

const HORAS_OPCIONES = Array.from({ length: 24 }, (_, i) => (i + 1) / 2) // 0,5 … 12

function hoyLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
function horaFin(iso: string, horas: number): string {
  return new Date(new Date(iso).getTime() + horas * 3_600_000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function mesActual(): { desde: string; hasta: string } {
  const d = new Date()
  const ini = new Date(d.getFullYear(), d.getMonth(), 1)
  const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { desde: f(ini), hasta: f(fin) }
}

export default function AsignacionHorasAdministrativasPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.HORAS_ADMIN_ASIGNAR} showDefaultMessage>
        <Contenido />
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Contenido() {
  const [guias, setGuias] = useState<Guia[]>([])
  const [buscarGuia, setBuscarGuia] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [fecha, setFecha] = useState(hoyLocal())
  const [hora, setHora] = useState('09:00')
  const [horas, setHoras] = useState(1)
  const [motivo, setMotivo] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [conflictos, setConflictos] = useState<Conflicto[]>([])

  const [filtro, setFiltro] = useState(mesActual())
  const [items, setItems] = useState<Asignacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [borrar, setBorrar] = useState<{ tipo: 'fila' | 'grupo'; item: Asignacion; n: number } | null>(null)

  useEffect(() => {
    fetch('/api/postgres/guias')
      .then(r => r.json())
      .then(j => {
        const list = (j.advisors || j.data || j.items || j.guias || []) as any[]
        setGuias(list
          .filter(a => a.activo !== false)
          .map(a => ({ _id: a._id, nombre: a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim() || a.email || a._id }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
      })
      .catch(() => setGuias([]))
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const qs = new URLSearchParams()
      if (filtro.desde) qs.set('startDate', new Date(`${filtro.desde}T00:00:00`).toISOString())
      if (filtro.hasta) qs.set('endDate', new Date(`${filtro.hasta}T23:59:59`).toISOString())
      const r = await fetch(`/api/postgres/admin-events/asignacion?${qs}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Error al cargar')
      setItems(j.items || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar las asignaciones')
    } finally {
      setCargando(false)
    }
  }, [filtro])
  useEffect(() => { cargar() }, [cargar])

  const guiasVisibles = useMemo(() => {
    const q = buscarGuia.trim().toLowerCase()
    return q ? guias.filter(g => g.nombre.toLowerCase().includes(q)) : guias
  }, [guias, buscarGuia])
  const nombreDe = useMemo(() => new Map(guias.map(g => [g._id, g.nombre])), [guias])

  const toggle = (id: string) => setSeleccion(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })
  const marcarVisibles = (on: boolean) => setSeleccion(prev => {
    const s = new Set(prev); guiasVisibles.forEach(g => on ? s.add(g._id) : s.delete(g._id)); return s
  })

  const fechaInicioISO = useMemo(() => {
    if (!fecha || !hora) return ''
    const d = new Date(`${fecha}T${hora}:00`)
    return isNaN(d.getTime()) ? '' : d.toISOString()
  }, [fecha, hora])

  const faltante = !seleccion.size ? 'Selecciona al menos un guía'
    : !fechaInicioISO ? 'Indica la fecha y la hora de inicio'
    : !motivo.trim() ? 'Escribe el motivo'
    : null

  const guardar = async () => {
    setGuardando(true); setConflictos([])
    try {
      const r = await fetch('/api/postgres/admin-events/asignacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          advisorIds: Array.from(seleccion),
          fechaInicio: fechaInicioISO,
          horas,
          motivo: motivo.trim(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        if (Array.isArray(j?.detail)) setConflictos(j.detail)
        throw new Error(j?.error || 'No se pudieron asignar las horas')
      }
      toast.success(j.message || 'Horas asignadas')
      setConfirmar(false)
      setSeleccion(new Set()); setMotivo('')
      await cargar()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
      setConfirmar(false)
    } finally {
      setGuardando(false)
    }
  }

  const tamGrupo = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach(i => m.set(i.eventGroupId, (m.get(i.eventGroupId) || 0) + 1))
    return m
  }, [items])
  const totalHoras = useMemo(() => items.reduce((s, i) => s + Number(i.horas || 0), 0), [items])

  const ejecutarBorrado = async () => {
    if (!borrar) return
    const url = borrar.tipo === 'grupo'
      ? `/api/postgres/admin-events/asignacion?groupId=${encodeURIComponent(borrar.item.eventGroupId)}`
      : `/api/postgres/admin-events/asignacion?id=${encodeURIComponent(borrar.item._id)}`
    try {
      const r = await fetch(url, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo eliminar')
      toast.success(`Eliminada(s): ${j.deleted}`)
      setBorrar(null)
      await cargar()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClockIcon className="h-8 w-8 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asignación Horas Administrativas</h1>
          <p className="text-sm text-gray-600">
            Las horas asignadas quedan registradas y cuentan en el Control de Horas del guía
            (Effective y Administrative Hours) cuando llega su fecha. El guía no tiene que hacer nada.
          </p>
        </div>
      </div>

      {/* Formulario */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-700">Guías <span className="text-red-500">*</span></label>
            <span className="text-xs text-gray-500">{seleccion.size} seleccionado(s)</span>
          </div>
          <input
            value={buscarGuia}
            onChange={e => setBuscarGuia(e.target.value)}
            placeholder="Buscar guía…"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-2"
          />
          <div className="flex gap-2 mb-2 text-xs">
            <button type="button" onClick={() => marcarVisibles(true)} className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Marcar todos los visibles</button>
            <button type="button" onClick={() => marcarVisibles(false)} className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Desmarcar visibles</button>
          </div>
          <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto divide-y divide-gray-100">
            {guiasVisibles.length === 0 && <p className="p-3 text-sm text-gray-500">Sin guías</p>}
            {guiasVisibles.map(g => (
              <label key={g._id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={seleccion.has(g._id)} onChange={() => toggle(g._id)} />
                {g.nombre}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Fecha <span className="text-red-500">*</span></label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Hora de inicio <span className="text-red-500">*</span></label>
              <input type="time" value={hora} onChange={e => setHora(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Número de horas <span className="text-red-500">*</span></label>
            <select value={horas} onChange={e => setHoras(Number(e.target.value))} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
              {HORAS_OPCIONES.map(h => <option key={h} value={h}>{formatHoras(h)} {h === 1 ? 'hora' : 'horas'}</option>)}
            </select>
            {fechaInicioISO && (
              <p className="text-xs text-gray-500 mt-1">Horario: {hora} – {horaFin(fechaInicioISO, horas)}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Motivo <span className="text-red-500">*</span></label>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Ej. Capacitación de metodología, preparación de material…"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          {faltante && <p className="text-xs text-amber-700">{faltante}</p>}
          <button
            type="button"
            disabled={!!faltante || guardando}
            onClick={() => setConfirmar(true)}
            className="w-full px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            Asignar horas
          </button>
        </div>

        {conflictos.length > 0 && (
          <div className="lg:col-span-2 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm font-semibold text-red-800 mb-2">Choques de horario — esas horas ya están ocupadas:</p>
            <ul className="text-sm text-red-700 space-y-1">
              {conflictos.map((c, i) => (
                <li key={i}>
                  <b>{c.advisorNombre || nombreDe.get(c.advisorId) || c.advisorId}</b> · {fechaHora(c.fecha)} · {c.tipo || ''} {c.descripcion ? `— ${c.descripcion}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Listado */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="p-4 border-b flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Desde</label>
            <input type="date" value={filtro.desde} onChange={e => setFiltro(f => ({ ...f, desde: e.target.value }))} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Hasta</label>
            <input type="date" value={filtro.hasta} onChange={e => setFiltro(f => ({ ...f, hasta: e.target.value }))} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <p className="ml-auto text-sm text-gray-700">
            {items.length} asignación(es) · <b>{formatHoras(totalHoras)} h</b>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Guía</th>
                <th className="px-3 py-2 text-left">Fecha y hora</th>
                <th className="px-3 py-2 text-left">Horas</th>
                <th className="px-3 py-2 text-left">Motivo</th>
                <th className="px-3 py-2 text-left">Asignó</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cargando && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
              {!cargando && items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No hay horas asignadas en este período</td></tr>}
              {!cargando && items.map(it => (
                <tr key={it._id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{it.advisorNombre || nombreDe.get(it.advisorId) || it.advisorId}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fechaHora(it.fechaInicio)} – {horaFin(it.fechaInicio, it.horas)}</td>
                  <td className="px-3 py-2">{formatHoras(it.horas)}</td>
                  <td className="px-3 py-2 max-w-xs truncate" title={it.descripcion || ''}>{it.descripcion || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{it.createdBy || '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setBorrar({ tipo: 'fila', item: it, n: 1 })}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                      title="Eliminar esta asignación"
                    >
                      <TrashIcon className="h-4 w-4" /> Eliminar
                    </button>
                    {(tamGrupo.get(it.eventGroupId) || 0) > 1 && (
                      <button
                        type="button"
                        onClick={() => setBorrar({ tipo: 'grupo', item: it, n: tamGrupo.get(it.eventGroupId) || 0 })}
                        className="ml-3 text-xs text-red-600 hover:text-red-800 underline"
                      >
                        Todo el grupo ({tamGrupo.get(it.eventGroupId)})
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmación */}
      {confirmar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !guardando && setConfirmar(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Confirmar asignación</h3>
              <button type="button" onClick={() => setConfirmar(false)} title="Cerrar"><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p>
                Se asignarán <b>{formatHoras(horas)} {horas === 1 ? 'hora' : 'horas'}</b> el <b>{fechaInicioISO && fechaHora(fechaInicioISO)}</b>
                {' '}({hora} – {fechaInicioISO && horaFin(fechaInicioISO, horas)}) a <b>{seleccion.size}</b> guía(s):
              </p>
              <ul className="max-h-40 overflow-y-auto border rounded-md divide-y text-gray-700">
                {Array.from(seleccion).map(id => <li key={id} className="px-3 py-1">{nombreDe.get(id) || id}</li>)}
              </ul>
              <p className="text-gray-600"><b>Motivo:</b> {motivo}</p>
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
                Las horas quedan registradas y suman en el Control de Horas de cada guía cuando llega la fecha.
              </p>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} disabled={guardando} className="px-4 py-2 rounded-md border border-gray-300 text-sm">Cancelar</button>
              <button type="button" onClick={guardar} disabled={guardando} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {guardando ? 'Asignando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Eliminar */}
      {borrar && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setBorrar(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">Eliminar asignación</h3>
            <p className="text-sm text-gray-700">
              {borrar.tipo === 'grupo'
                ? <>Se eliminarán las <b>{borrar.n}</b> asignaciones de este grupo ({fechaHora(borrar.item.fechaInicio)}). Esas horas dejan de contar.</>
                : <>Se eliminarán las <b>{formatHoras(borrar.item.horas)} h</b> asignadas a <b>{borrar.item.advisorNombre || borrar.item.advisorId}</b> el {fechaHora(borrar.item.fechaInicio)}. Dejan de contar.</>}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBorrar(null)} className="px-4 py-2 rounded-md border border-gray-300 text-sm">Cancelar</button>
              <button type="button" onClick={ejecutarBorrado} className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
