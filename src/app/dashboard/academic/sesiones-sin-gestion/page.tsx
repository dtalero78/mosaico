'use client'

import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission } from '@/types/permissions'
import {
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

/**
 * "Sesiones sin gestión" — backlog de eventos pasados (sin contar hoy) que
 * el advisor no registró dentro de su ventana de +120 min. Default: ayer +
 * todos los advisors. El coordinador entra desde la columna "Ir a evento"
 * y gestiona el cierre con bypass de ventana.
 */

interface AdvisorOption {
  _id: string
  nombre: string
}

interface Item {
  eventoId: string
  fechaEvento: string | null
  tipo: 'SESSION' | 'CLUB' | string
  nivel: string | null
  step: string | null
  tituloEvento: string | null
  nombreEvento: string | null
  advisorId: string | null
  advisorNombre: string
  advisorFoto: string | null
  inscritos: number
  asistioMarcados: number
}

const PAD = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DD" en la TZ local del navegador. */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`
}

function yesterdayLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return ymdLocal(d)
}

/** Hora local del navegador en HH:MM (24h). */
function horaLocal(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('es', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
  } catch { return '—' }
}

/** Fecha local del navegador formateada como "Mar 4 jun". */
function fechaCorta(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('es', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
  } catch { return '—' }
}

/** Días transcurridos desde fechaEvento hasta NOW (floor, en días enteros). */
function diasDesde(iso: string | null): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export default function SesionesSinGestionPage() {
  const [startDate, setStartDate] = useState<string>(yesterdayLocal())
  const [endDate, setEndDate] = useState<string>(yesterdayLocal())
  const [advisorId, setAdvisorId] = useState<string>('')
  const [tipo, setTipo] = useState<string>('')

  const [advisors, setAdvisors] = useState<AdvisorOption[]>([])
  const [advisorsLoading, setAdvisorsLoading] = useState(true)

  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cargar advisors activos para el dropdown
  useEffect(() => {
    fetch('/api/postgres/advisors')
      .then(r => r.json())
      .then(j => {
        const list = (j.advisors || j.data || j.items || []) as any[]
        setAdvisors(
          list
            .filter(a => a.activo !== false)
            .map(a => ({ _id: a._id, nombre: a.nombreCompleto || `${a.primerNombre || ''} ${a.primerApellido || ''}`.trim() || a.email || a._id }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        )
      })
      .catch(() => setAdvisors([]))
      .finally(() => setAdvisorsLoading(false))
  }, [])

  const load = async () => {
    if (!startDate || !endDate) { toast.error('Selecciona un rango válido'); return }
    setLoading(true); setError(null)
    try {
      const tz = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' }
        catch { return 'America/Bogota' }
      })()
      const qs = new URLSearchParams({ startDate, endDate, tz })
      if (advisorId) qs.set('advisorId', advisorId)
      if (tipo)      qs.set('tipo', tipo)
      const r = await fetch(`/api/postgres/reports/academico/sesiones-sin-gestion?${qs}`)
      const j = await r.json()
      if (!r.ok || !j.success) throw new Error(j?.error || `Error ${r.status}`)
      setItems(j.items as Item[])
    } catch (e: any) {
      setError(e?.message || 'Error al cargar')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  // Carga inicial con defaults (ayer)
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // KPIs derivados
  const stats = useMemo(() => {
    const total = items.length
    const sinAsistencia = items.filter(i => i.asistioMarcados === 0).length
    const conAsistenciaParcial = items.filter(i => i.asistioMarcados > 0 && !i.inscritos).length
    const advisorsDistintos = new Set(items.map(i => i.advisorId || '__')).size
    return { total, sinAsistencia, conAsistenciaParcial, advisorsDistintos }
  }, [items])

  const resetToDefault = () => {
    setStartDate(yesterdayLocal())
    setEndDate(yesterdayLocal())
    setAdvisorId('')
    setTipo('')
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.SESIONES_SIN_GESTION_VER}>
        <div className="space-y-5 pb-10">
          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-100 rounded-full flex-shrink-0">
                <ExclamationTriangleIcon className="h-7 w-7 text-amber-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Sesiones sin gestión</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  Eventos pasados sin registrar — el coordinador puede entrar a cada uno y gestionar el cierre.
                  Default: ayer · todos los advisors. Hoy se excluye (aún en ventana operativa).
                </p>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label htmlFor="start-date" className="block text-xs font-medium text-gray-600 mb-1">Desde</label>
                <input
                  id="start-date" type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="end-date" className="block text-xs font-medium text-gray-600 mb-1">Hasta</label>
                <input
                  id="end-date" type="date" value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="advisor-select" className="block text-xs font-medium text-gray-600 mb-1">Advisor</label>
                <select
                  id="advisor-select"
                  value={advisorId}
                  onChange={e => setAdvisorId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  disabled={advisorsLoading}
                >
                  <option value="">Todos</option>
                  {advisors.map(a => <option key={a._id} value={a._id}>{a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="tipo-select" className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select
                  id="tipo-select"
                  value={tipo}
                  onChange={e => setTipo(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Todos</option>
                  <option value="SESSION">Session</option>
                  <option value="CLUB">Club</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button" onClick={load} disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {loading ? 'Cargando…' : 'Buscar'}
                </button>
                <button
                  type="button" onClick={resetToDefault}
                  className="px-3 py-2 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
                  title="Volver al default (ayer · todos)"
                >
                  ⟲
                </button>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total sin gestionar" value={stats.total.toLocaleString()} color="amber" />
            <Kpi label="Sin asistencia marcada" value={stats.sinAsistencia.toLocaleString()} sub="advisor no entró o no marcó" color="red" />
            <Kpi label="Advisors involucrados" value={stats.advisorsDistintos.toLocaleString()} color="indigo" />
            <Kpi label="Rango" value={startDate === endDate ? fechaCorta(startDate + 'T12:00') : `${fechaCorta(startDate + 'T12:00')} → ${fechaCorta(endDate + 'T12:00')}`} color="gray" />
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
              <div className="p-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mb-3">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-sm font-semibold text-emerald-700">No hay sesiones sin gestionar en el rango</p>
                <p className="text-xs text-gray-500 mt-1">Todo el backlog está al día — buen trabajo.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-xs text-gray-500 uppercase">
                    <th className="text-left font-medium px-3 py-2">Advisor</th>
                    <th className="text-left font-medium px-3 py-2 w-24">Tipo</th>
                    <th className="text-left font-medium px-3 py-2">Nivel · Step</th>
                    <th className="text-left font-medium px-3 py-2 w-32">Fecha · Hora</th>
                    <th className="text-center font-medium px-3 py-2 w-36">Inscritos / Asistencia</th>
                    <th className="text-left font-medium px-3 py-2 w-28">Hace</th>
                    <th className="text-right font-medium px-3 py-2 w-20">Ir</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const dias = diasDesde(it.fechaEvento)
                    const sinAsistencia = it.asistioMarcados === 0
                    return (
                      <tr key={it.eventoId} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${sinAsistencia ? 'bg-red-50/30' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 h-7 w-7 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                              <UserCircleIcon className="h-6 w-6 text-gray-400" />
                            </div>
                            <span className="text-sm font-medium text-gray-900">{it.advisorNombre}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {it.tipo === 'SESSION' ? (
                            <span className="inline-flex items-center text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">SESSION</span>
                          ) : it.tipo === 'CLUB' ? (
                            <span className="inline-flex items-center text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">CLUB</span>
                          ) : (
                            <span className="inline-flex items-center text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">{it.tipo || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm text-gray-900">{it.nivel || '—'} · {it.step || '—'}</div>
                          {it.nombreEvento && it.nombreEvento !== it.step && (
                            <div className="text-[11px] text-gray-500 truncate max-w-xs">{it.nombreEvento}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm text-gray-900">{fechaCorta(it.fechaEvento)}</div>
                          <div className="text-xs font-mono text-gray-600">{horaLocal(it.fechaEvento)}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${
                            sinAsistencia
                              ? 'bg-red-100 text-red-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {it.asistioMarcados} / {it.inscritos}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-medium ${dias > 7 ? 'text-red-700' : 'text-gray-600'}`}>
                            {dias === 0 ? '< 1 día' : dias === 1 ? '1 día' : `${dias} días`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={`/sesion/${it.eventoId}`}
                            target="_blank" rel="noopener noreferrer"
                            title="Ir al panel de la sesión (gestionar cierre)"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-md hover:bg-indigo-50 text-indigo-600 hover:text-indigo-700"
                          >
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
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: 'amber' | 'red' | 'indigo' | 'gray' }) {
  const bg = color === 'amber' ? 'bg-amber-50 border-amber-200'
    : color === 'red' ? 'bg-red-50 border-red-200'
    : color === 'indigo' ? 'bg-indigo-50 border-indigo-200'
    : 'bg-gray-50 border-gray-200'
  const txt = color === 'amber' ? 'text-amber-900'
    : color === 'red' ? 'text-red-900'
    : color === 'indigo' ? 'text-indigo-900'
    : 'text-gray-900'
  return (
    <div className={`${bg} border rounded-xl p-3`}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</p>
      <p className={`text-xl font-bold ${txt} truncate`} title={value}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 truncate">{sub}</p>}
    </div>
  )
}
