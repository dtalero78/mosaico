'use client'

import { useEffect, useState, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Row {
  _id: string; advisor: string; guiaNombre: string; curso: string; salon: string | null
  campaign: string | null; horario: string | null
  dia: string; repetirLeccion: string | null; fechaRepetirSesion: string | null; repetirMarcadoPor: string | null
}
interface Opciones { guias: { id: string; nombre: string }[]; cursos: string[]; salones: string[] }

function fmt(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return d }
}
function fmtDia(d: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}

export default function SolicitudSesionesPage() {
  const { hasPermission, isRole } = usePermissions()
  const puedeGestionar = isRole('SUPER_ADMIN') || isRole('ADMIN') || hasPermission(AcademicoPermission.SOLICITUD_SESIONES_GESTION)

  const [rows, setRows] = useState<Row[]>([])
  const [opciones, setOpciones] = useState<Opciones>({ guias: [], cursos: [], salones: [] })
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [authorizing, setAuthorizing] = useState(false)

  // filtros
  const [guia, setGuia] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (guia) qs.set('guia', guia)
    if (curso) qs.set('curso', curso)
    if (salon) qs.set('salon', salon)
    if (startDate) qs.set('startDate', startDate)
    if (endDate) qs.set('endDate', endDate)
    fetch(`/api/postgres/reports/academico/solicitud-sesiones?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setRows(d.rows || []); setOpciones(d.opciones || { guias: [], cursos: [], salones: [] }); setSel(new Set()) })
      .catch(() => toast.error('Error al cargar solicitudes'))
      .finally(() => setLoading(false))
  }, [guia, curso, salon, startDate, endDate])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r._id)))

  const autorizar = async () => {
    if (sel.size === 0) return
    if (!confirm(`¿Autorizar ${sel.size} solicitud(es) de repetir lección?`)) return
    setAuthorizing(true)
    try {
      const r = await fetch('/api/postgres/reports/academico/solicitud-sesiones/autorizar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventoIds: Array.from(sel) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Error')
      toast.success(`${j.autorizadas} autorizada(s)`)
      load()
    } catch (e: any) { toast.error(e.message) } finally { setAuthorizing(false) }
  }

  const limpiar = () => { setGuia(''); setCurso(''); setSalon(''); setStartDate(''); setEndDate('') }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.SOLICITUD_SESIONES_VER} showDefaultMessage>
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Solicitud de Sesiones</h1>
          <p className="text-gray-500 mb-6">Solicitudes de <b>Repetir Lección</b> marcadas por los guías, pendientes de autorización.</p>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Guía</label>
              <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Curso</label>
              <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.cursos.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Salón</label>
              <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>
                {opciones.salones.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desde (solicitud)</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hasta (solicitud)</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={limpiar} className="text-sm text-gray-500 hover:text-gray-700">Limpiar filtros</button>
              <span className="text-sm text-gray-400">{rows.length} solicitud(es)</span>
            </div>
            {puedeGestionar && (
              <button type="button" onClick={autorizar} disabled={sel.size === 0 || authorizing}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1">
                <CheckCircleIcon className="w-4 h-4" /> {authorizing ? 'Autorizando…' : `Autorizar (${sel.size})`}
              </button>
            )}
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    {puedeGestionar && <th className="px-3 py-2 w-8"><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} /></th>}
                    <th className="px-3 py-2 text-left">Guía</th>
                    <th className="px-3 py-2 text-left">Campaña</th>
                    <th className="px-3 py-2 text-left">Curso</th>
                    <th className="px-3 py-2 text-left">Salón</th>
                    <th className="px-3 py-2 text-left">Lección solicitada</th>
                    <th className="px-3 py-2 text-left">Fecha del evento</th>
                    <th className="px-3 py-2 text-left">Fecha de solicitud</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400"><ArrowPathIcon className="w-5 h-5 animate-spin inline" /> Cargando…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">No hay solicitudes pendientes.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r._id} className={sel.has(r._id) ? 'bg-emerald-50/50' : ''}>
                      {puedeGestionar && <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r._id)} onChange={() => toggle(r._id)} /></td>}
                      <td className="px-3 py-2 font-medium text-gray-800">{r.guiaNombre}</td>
                      <td className="px-3 py-2">{r.campaign || '—'}</td>
                      <td className="px-3 py-2">{r.curso}</td>
                      <td className="px-3 py-2">{r.salon || '—'}</td>
                      <td className="px-3 py-2"><b>{r.repetirLeccion || '—'}</b></td>
                      <td className="px-3 py-2">{fmtDia(r.dia)}</td>
                      <td className="px-3 py-2">{fmt(r.fechaRepetirSesion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
