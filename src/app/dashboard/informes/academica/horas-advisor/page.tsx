'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { exportToExcel } from '@/lib/export-excel'

interface Advisor { _id: string; nombreCompleto: string; pais: string | null }

interface HorasRow {
  advisorId: string
  advisorNombre: string
  plataforma: string | null
  numeroId: string | null
  conducted: number
  suspended: number
  cancelled: number
  total: number
}

interface ReportData {
  table: HorasRow[]
  totals: { conducted: number; suspended: number; cancelled: number; total: number }
  charts: {
    barByAdvisor: { name: string; fullName: string; conducted: number; suspended: number; cancelled: number }[]
    donut: { name: string; value: number }[]
  }
  meta: { plataformas: string[]; advisors: Advisor[] }
}

const STATE_COLORS: Record<string, string> = {
  conducted: '#22c55e',
  suspended: '#f59e0b',
  cancelled: '#ef4444',
}

const today       = new Date().toISOString().substring(0, 10)
const firstOfYear = `${new Date().getFullYear()}-01-01`

// ── Dona SVG (total al centro + leyenda con % respecto al total) ──
function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
  const r = 55, cx = 70, cy = 70, sw = 22, circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-4 flex-wrap justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0">
        {data.map((seg, i) => {
          const pct  = seg.value / total
          const dash = pct * circ
          const gap  = circ - dash
          const rot  = offset * 360 - 90
          offset += pct
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={STATE_COLORS[seg.name.toLowerCase()] ?? '#9ca3af'}
            strokeWidth={sw}
            strokeDasharray={`${dash} ${gap}`} strokeLinecap="butt"
            transform={`rotate(${rot} ${cx} ${cy})`} />
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="18" fontWeight="bold" fill="#1f2937">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#6b7280">TOTAL</text>
      </svg>
      <div className="space-y-1.5">
        {data.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: STATE_COLORS[seg.name.toLowerCase()] ?? '#9ca3af' }} />
            <span className="text-gray-600 w-20">{seg.name}</span>
            <span className="font-semibold text-gray-900 w-10 text-right">{seg.value.toLocaleString()}</span>
            <span className="text-gray-400">{((seg.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

export default function HorasAdvisorPage() {
  const [fechaInicio, setFechaInicio] = useState(firstOfYear)
  const [fechaFin,    setFechaFin]    = useState(today)
  const [plataforma,  setPlataforma]  = useState('')
  const [advisorId,   setAdvisorId]   = useState('')
  const [data,    setData]    = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetchData = useCallback(async (fi: string, ff: string, plat: string, aid: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ fechaInicio: fi, fechaFin: ff })
      if (plat) qs.set('plataforma', plat)
      if (aid)  qs.set('advisorId', aid)
      const res  = await fetch(`/api/postgres/reports/academica/horas-advisor?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error al cargar datos')
      // successResponse hace spread en la raíz: { success, table, totals, charts, meta }
      setData({ table: json.table ?? [], totals: json.totals, charts: json.charts, meta: json.meta })
    } catch (e: any) { setError(e.message || 'Error inesperado') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(firstOfYear, today, '', '') }, [fetchData])

  const handleApply = () => fetchData(fechaInicio, fechaFin, plataforma, advisorId)
  const handleClear = () => {
    setFechaInicio(firstOfYear); setFechaFin(today); setPlataforma(''); setAdvisorId('')
    fetchData(firstOfYear, today, '', '')
  }

  const handleExport = () => {
    if (!data?.table.length) return
    exportToExcel(
      data.table,
      [
        { header: 'Advisor',    accessor: r => r.advisorNombre },
        { header: 'NumeroId',   accessor: r => r.numeroId ?? '' },
        { header: 'País',       accessor: r => r.plataforma ?? '' },
        { header: 'Conducted',  accessor: r => r.conducted },
        { header: 'Suspended',  accessor: r => r.suspended },
        { header: 'Cancelled',  accessor: r => r.cancelled },
        { header: 'Total Booking', accessor: r => r.total },
      ],
      `horas-advisor_${fechaInicio}_${fechaFin}`
    )
  }

  const totals = data?.totals
  // Filtra el dropdown de advisors por plataforma seleccionada
  const advisorOptions = useMemo(() => {
    const all = data?.meta?.advisors ?? []
    return plataforma ? all.filter(a => a.pais === plataforma) : all
  }, [data, plataforma])

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informe de horas Advisor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sesiones conducted, suspended y cancelled por advisor en el período seleccionado.
          </p>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="ha-plataforma" className="block text-xs text-gray-500 mb-1">País</label>
              <select id="ha-plataforma" value={plataforma}
                onChange={e => { setPlataforma(e.target.value); setAdvisorId('') }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]">
                <option value="">Todas</option>
                {(data?.meta?.plataformas ?? []).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ha-advisor" className="block text-xs text-gray-500 mb-1">Advisor</label>
              <select id="ha-advisor" value={advisorId} onChange={e => setAdvisorId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
                <option value="">Todos los advisors</option>
                {advisorOptions.map(a => <option key={a._id} value={a._id}>{a.nombreCompleto}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ha-inicio" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
              <input id="ha-inicio" type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="ha-fin" className="block text-xs text-gray-500 mb-1">Fecha final</label>
              <input id="ha-fin" type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-2 ml-auto flex-wrap">
              <button type="button" onClick={handleApply} disabled={loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                Aplicar filtros
              </button>
              <button type="button" onClick={handleClear} disabled={loading}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                Limpiar filtros
              </button>
              <button type="button" onClick={handleExport} disabled={loading || !data?.table.length}
                className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                Exportar CSV
              </button>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
            <button type="button" onClick={handleApply} className="ml-4 text-xs underline">Reintentar</button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Total Sesiones" value={(totals?.total ?? 0).toLocaleString()} color="#3b82f6" />
          <KpiCard label="Conducted" value={(totals?.conducted ?? 0).toLocaleString()} color={STATE_COLORS.conducted} />
          <KpiCard label="Suspended" value={(totals?.suspended ?? 0).toLocaleString()} color={STATE_COLORS.suspended} />
          <KpiCard label="Cancelled" value={(totals?.cancelled ?? 0).toLocaleString()} color={STATE_COLORS.cancelled} />
        </div>

        {/* Charts: barras horizontales (izq) + dona (der) */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Sesiones por Advisor y Estado</h3>
            {loading ? (
              <div className="h-64 bg-gray-100 rounded animate-pulse" />
            ) : !data?.charts.barByAdvisor.length ? (
              <p className="text-sm text-gray-400 text-center py-10">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(260, data.charts.barByAdvisor.length * 30)}>
                <BarChart data={data.charts.barByAdvisor} layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120}
                    tickFormatter={v => v.length > 18 ? `${v.slice(0, 17)}…` : v} />
                  <Tooltip
                    formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
                    labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullName ?? ''}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="conducted" name="Conducted" fill={STATE_COLORS.conducted} stackId="a" />
                  <Bar dataKey="suspended" name="Suspended" fill={STATE_COLORS.suspended} stackId="a" />
                  <Bar dataKey="cancelled" name="Cancelled" fill={STATE_COLORS.cancelled} stackId="a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución por Estado</h3>
            {loading
              ? <div className="h-48 bg-gray-100 rounded animate-pulse" />
              : <DonutChart data={data?.charts.donut ?? []} />
            }
          </div>
        </div>

        {/* Detalle */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800">Detalle por Advisor</h3>
            <p className="text-xs text-gray-400 mt-0.5">{(data?.table.length ?? 0).toLocaleString()} advisors</p>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Cargando...</p>
            </div>
          ) : !data?.table.length ? (
            <p className="text-sm text-gray-400 text-center p-8">Sin datos para el período seleccionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    {['#', 'Advisor', 'NumeroId', 'Conducted', 'Suspended', 'Cancelled', 'Total Booking'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.table.map((row, i) => (
                    <tr key={row.advisorId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[200px] truncate" title={row.advisorNombre}>{row.advisorNombre}</td>
                      <td className="px-3 py-2.5 text-gray-600 font-mono text-xs">{row.numeroId ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">{row.conducted}</span></td>
                      <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">{row.suspended}</span></td>
                      <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-semibold">{row.cancelled}</span></td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-900">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                  <tr className="font-semibold text-gray-900">
                    <td className="px-3 py-3" colSpan={3}>Totales</td>
                    <td className="px-3 py-3 text-center text-green-700">{totals?.conducted ?? 0}</td>
                    <td className="px-3 py-3 text-center text-amber-700">{totals?.suspended ?? 0}</td>
                    <td className="px-3 py-3 text-center text-red-600">{totals?.cancelled ?? 0}</td>
                    <td className="px-3 py-3 text-right">{totals?.total ?? 0}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  )
}
