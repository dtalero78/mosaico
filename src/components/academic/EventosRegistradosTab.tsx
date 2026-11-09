'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

/**
 * Pestaña "Eventos registrados" de Procesos sin gestión: sesiones YA CERRADAS.
 * Coordinación/Admin entran con «Ir» y corrigen la asistencia (marcar o desmarcar);
 * la sesión sigue cerrada. Quedan fuera las nivelaciones y las sesiones cuyo
 * informe semanal ya es DEFINITIVO. Default: semana corriente + la anterior.
 */

interface Item {
  eventoId: string
  fechaEvento: string | null
  tipo: string
  nivel: string | null
  campaign: string | null
  curso: string | null
  salon: string | null
  nombreEvento: string | null
  advisorId: string | null
  advisorNombre: string
  inscritos: number
  asistioMarcados: number
}

const PAD = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`

/** Lunes de la semana anterior → hoy (semana corriente + la anterior). */
function rangoPorDefecto() {
  const hoy = new Date()
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7) - 7)
  return { desde: ymd(lunes), hasta: ymd(hoy) }
}

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
const diasDesde = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : 0

export default function EventosRegistradosTab({ onCount }: { onCount?: (n: number) => void }) {
  const def = rangoPorDefecto()
  const [desde, setDesde] = useState(def.desde)
  const [hasta, setHasta] = useState(def.hasta)
  const [advisorId, setAdvisorId] = useState('')
  const [tipo, setTipo] = useState('')
  const [guias, setGuias] = useState<Array<{ _id: string; nombre: string }>>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/postgres/guias').then(r => r.json()).then(j => {
      const list = (j.advisors || j.data || j.items || []) as any[]
      setGuias(list.filter(a => a.activo !== false)
        .map(a => ({ _id: a._id, nombre: a.nombreCompleto || a.email || a._id }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
    }).catch(() => {})
  }, [])

  const cargar = useCallback(async (d = desde, h = hasta) => {
    setLoading(true)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota'
      const qs = new URLSearchParams({ startDate: d, endDate: h, tz })
      if (advisorId) qs.set('advisorId', advisorId)
      if (tipo) qs.set('tipo', tipo)
      const r = await fetch(`/api/postgres/reports/academico/eventos-registrados?${qs}`)
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      setItems(j.items as Item[])
      onCount?.((j.items as Item[]).length)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [desde, hasta, advisorId, tipo, onCount])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [])

  const limpiar = () => {
    const r = rangoPorDefecto()
    setDesde(r.desde); setHasta(r.hasta); setAdvisorId(''); setTipo('')
    setTimeout(() => cargar(r.desde, r.hasta), 0)
  }

  const inp = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm'
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label htmlFor="er-desde" className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
            <input id="er-desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inp} />
          </div>
          <div>
            <label htmlFor="er-hasta" className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
            <input id="er-hasta" type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inp} />
          </div>
          <div>
            <label htmlFor="er-guia" className="block text-xs font-medium text-gray-600 mb-1">Guía</label>
            <select id="er-guia" value={advisorId} onChange={e => setAdvisorId(e.target.value)} className={inp}>
              <option value="">Todos</option>
              {guias.map(g => <option key={g._id} value={g._id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="er-tipo" className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
            <select id="er-tipo" value={tipo} onChange={e => setTipo(e.target.value)} className={inp}>
              <option value="">Todos</option>
              <option value="SESSION">Sesión</option>
              <option value="CLUB">Taller</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => cargar()} disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Buscar
            </button>
            <button type="button" onClick={limpiar} title="Restablecer"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50">⟲</button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Sesiones ya cerradas. Con «Ir» puedes marcar o desmarcar la asistencia; la sesión sigue cerrada.
          No incluye nivelaciones ni sesiones cuyo informe semanal ya es definitivo.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No hay eventos registrados en el rango.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs text-gray-500 uppercase">
                <th className="text-left font-medium px-3 py-2">Guía</th>
                <th className="text-left font-medium px-3 py-2 w-24">Tipo</th>
                <th className="text-left font-medium px-3 py-2">Campaña · Curso · Salón</th>
                <th className="text-left font-medium px-3 py-2 w-32">Fecha · Hora</th>
                <th className="text-center font-medium px-3 py-2 w-36">Inscritos / Asistencia</th>
                <th className="text-left font-medium px-3 py-2 w-28">Hace</th>
                <th className="text-right font-medium px-3 py-2 w-20">Ir</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => {
                const dias = diasDesde(it.fechaEvento)
                return (
                  <tr key={it.eventoId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <UserCircleIcon className="h-6 w-6 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">{it.advisorNombre}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${it.tipo === 'SESSION' ? 'bg-blue-100 text-blue-700' : it.tipo === 'CLUB' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {it.tipo || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-sm text-gray-900">
                        {it.curso ? `${it.campaign ? it.campaign + ' · ' : ''}${it.curso}${it.salon ? ' · Salón ' + it.salon : ''}` : (it.nivel || '—')}
                      </div>
                      {it.nombreEvento && <div className="text-[11px] text-gray-500 truncate max-w-xs">{it.nombreEvento}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-sm text-gray-900">{fecha(it.fechaEvento)}</div>
                      <div className="text-xs font-mono text-gray-600">{hora(it.fechaEvento)}</div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded ${it.asistioMarcados === 0 ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {it.asistioMarcados} / {it.inscritos}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-gray-600">
                      {dias === 0 ? '< 1 día' : dias === 1 ? '1 día' : `${dias} días`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a href={`/sesion/${it.eventoId}`} target="_blank" rel="noopener noreferrer"
                        title="Ir a la sesión (corregir asistencia)"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
