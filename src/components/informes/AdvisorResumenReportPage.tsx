'use client'

import { useState, useCallback, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { exportToExcel } from '@/lib/export-excel'
import AdvisorScheduleTable, { type SessionRow } from './AdvisorScheduleTable'
import AdvisorSessionDetailModal from './AdvisorSessionDetailModal'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

type TipoFiltro = 'all' | 'sesiones' | 'jumps' | 'training' | 'clubes' | 'essential' | 'welcome'

interface Advisor { _id: string; nombreCompleto: string }

interface AdvisorRow {
  advisorNombre:  string
  advisorId:      string | null
  totalSesiones:  number
  totalJumps:     number
  totalTraining:  number
  totalClubes:    number
  totalEssential: number
  totalWelcome:   number
  totalGeneral:   number
  totalInscritos: number
  totalAsistentes: number
}

interface ReportData {
  kpis: {
    totalSesiones: number; totalJumps: number; totalTraining: number
    totalClubes: number; totalEssential: number; totalWelcome: number
    totalGeneral: number; totalInscritos: number; totalAsistentes: number; pctAsistencia: number
  }
  charts: {
    stackedByAdvisor: any[]
    donutByType:      { name: string; value: number }[]
  }
  table:          AdvisorRow[]
  sessionDetails: SessionRow[]     // individual events when advisor selected
  meta:           { advisors: Advisor[] }
}

const TIPO_OPTIONS: { value: TipoFiltro; label: string }[] = [
  { value: 'all',       label: 'Todos los tipos' },
  { value: 'sesiones',  label: 'Sesiones'         },
  { value: 'jumps',     label: 'Jumps'            },
  { value: 'training',  label: 'Training'         },
  { value: 'clubes',    label: 'Clubes'           },
  { value: 'essential', label: 'Essential (ESS)'  },
  { value: 'welcome',   label: 'Welcome'          },
]

const TYPE_COLORS: Record<string, string> = {
  sesiones:  '#3b82f6',
  jumps:     '#ef4444',
  training:  '#f97316',
  clubes:    '#22c55e',
  essential: '#0ea5e9',
  welcome:   '#a855f7',
}

const today       = new Date().toISOString().substring(0, 10)
const firstOfYear = `${new Date().getFullYear()}-01-01`

// ── KPI Card ─────────────────────────────────────────────────────────────────
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

// ── SVG Donut ─────────────────────────────────────────────────────────────────
function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
  const r = 55, cx = 70, cy = 70, sw = 22, circ = 2 * Math.PI * r
  let offset = 0
  const colors = Object.values(TYPE_COLORS)
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
            stroke={TYPE_COLORS[seg.name.toLowerCase()] ?? colors[i % colors.length]}
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
              style={{ backgroundColor: TYPE_COLORS[seg.name.toLowerCase()] ?? colors[i % colors.length] }} />
            <span className="text-gray-600 w-20">{seg.name}</span>
            <span className="font-semibold text-gray-900">{seg.value.toLocaleString()}</span>
            <span className="text-gray-400">{((seg.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AdvisorResumenReportPage() {
  const [fechaInicio, setFechaInicio] = useState(firstOfYear)
  const [fechaFin,    setFechaFin]    = useState(today)
  const [advisorId,   setAdvisorId]   = useState('')
  const [tipoFiltro,  setTipoFiltro]  = useState<TipoFiltro>('all')
  const [data,        setData]        = useState<ReportData | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const fetchData = useCallback(async (fi: string, ff: string, aid: string, tipo: TipoFiltro) => {
    setLoading(true); setError(null)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const qs = new URLSearchParams({ fechaInicio: fi, fechaFin: ff, advisorId: aid, tipoFiltro: tipo, tz })
      const res  = await fetch(`/api/postgres/reports/programacion/advisors/resumen?${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Error al cargar datos')
      setData(json.data ?? json)
    } catch (e: any) { setError(e.message || 'Error inesperado') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(firstOfYear, today, '', 'all') }, [fetchData])

  const handleApply = () => fetchData(fechaInicio, fechaFin, advisorId, tipoFiltro)
  const handleClear = () => {
    setFechaInicio(firstOfYear); setFechaFin(today)
    setAdvisorId(''); setTipoFiltro('all')
    fetchData(firstOfYear, today, '', 'all')
  }

  const handleExport = () => {
    if (!data?.table.length) return
    exportToExcel(
      data.table,
      [
        { header: 'Guía',    accessor: r => r.advisorNombre   },
        { header: 'Sesiones',   accessor: r => r.totalSesiones   },
        { header: 'Jumps',      accessor: r => r.totalJumps      },
        { header: 'Training',   accessor: r => r.totalTraining   },
        { header: 'Clubes',     accessor: r => r.totalClubes     },
        { header: 'Essential',  accessor: r => r.totalEssential  },
        { header: 'Welcome',    accessor: r => r.totalWelcome    },
        { header: 'Total',      accessor: r => r.totalGeneral    },
        { header: 'Inscritos',  accessor: r => r.totalInscritos  },
        { header: 'Asistentes', accessor: r => r.totalAsistentes },
        { header: '% Asistencia', accessor: r =>
          r.totalInscritos > 0 ? `${Math.round((r.totalAsistentes / r.totalInscritos) * 10000) / 100}%` : '0%'
        },
      ],
      `resumen-advisors_${fechaInicio}_${fechaFin}`
    )
  }

  const kpis = data?.kpis
  const advisors = data?.meta?.advisors ?? []

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resumen de Advisors</h1>
          <p className="text-sm text-gray-500 mt-1">
            Totales por advisor: Sesiones, Jumps, Training, Essential y Welcome
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="ar-inicio" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
              <input id="ar-inicio" type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="ar-fin" className="block text-xs text-gray-500 mb-1">Fecha final</label>
              <input id="ar-fin" type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="ar-advisor" className="block text-xs text-gray-500 mb-1">Guía</label>
              <select id="ar-advisor" value={advisorId} onChange={e => setAdvisorId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
                <option value="">Todos los advisors</option>
                {advisors.map(a => <option key={a._id} value={a._id}>{a.nombreCompleto}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ar-tipo" className="block text-xs text-gray-500 mb-1">Tipo de sesión</label>
              <select id="ar-tipo" value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value as TipoFiltro)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]">
                {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
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
              <PermissionGuard permission={InformesPermission.ADV_RESUMEN_EXP}>
                <button type="button" onClick={handleExport} disabled={loading || !data?.table.length}
                  className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Exportar Excel
                </button>
              </PermissionGuard>
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
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-20 mb-3" /><div className="h-8 bg-gray-200 rounded w-14" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Sesiones"  value={(kpis?.totalSesiones  ?? 0).toLocaleString()} color={TYPE_COLORS.sesiones}  />
            <KpiCard label="Jumps"     value={(kpis?.totalJumps     ?? 0).toLocaleString()} color={TYPE_COLORS.jumps}     />
            <KpiCard label="Training"  value={(kpis?.totalTraining  ?? 0).toLocaleString()} color={TYPE_COLORS.training}  />
            <KpiCard label="Clubes"    value={(kpis?.totalClubes    ?? 0).toLocaleString()} color={TYPE_COLORS.clubes}    />
            <KpiCard label="Essential" value={(kpis?.totalEssential ?? 0).toLocaleString()} color={TYPE_COLORS.essential} />
            <KpiCard label="Welcome"   value={(kpis?.totalWelcome   ?? 0).toLocaleString()} color={TYPE_COLORS.welcome}   />
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Stacked bar — all advisors */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Sesiones por Advisor y Tipo</h3>
            {loading ? (
              <div className="h-64 bg-gray-100 rounded animate-pulse" />
            ) : !data?.charts.stackedByAdvisor.length ? (
              <p className="text-sm text-gray-400 text-center py-10">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(260, data.charts.stackedByAdvisor.length * 28)}>
                <BarChart data={data.charts.stackedByAdvisor} layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110}
                    tickFormatter={v => v.length > 16 ? `${v.slice(0, 15)}…` : v} />
                  <Tooltip
                    formatter={(value: number, name: string) => [value, name.charAt(0).toUpperCase() + name.slice(1)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sesiones"  name="Sesiones"  fill={TYPE_COLORS.sesiones}  stackId="a" />
                  <Bar dataKey="jumps"     name="Jumps"     fill={TYPE_COLORS.jumps}     stackId="a" />
                  <Bar dataKey="training"  name="Training"  fill={TYPE_COLORS.training}  stackId="a" />
                  <Bar dataKey="clubes"    name="Clubes"    fill={TYPE_COLORS.clubes}    stackId="a" />
                  <Bar dataKey="essential" name="Essential" fill={TYPE_COLORS.essential} stackId="a" />
                  <Bar dataKey="welcome"   name="Welcome"   fill={TYPE_COLORS.welcome}   stackId="a" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Donut — distribution by type */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución por Tipo</h3>
            {loading
              ? <div className="h-48 bg-gray-100 rounded animate-pulse" />
              : <DonutChart data={data?.charts.donutByType ?? []} />
            }
          </div>
        </div>

        {/* Table — modo resumen (todos) o detalle (advisor seleccionado) */}
        {advisorId ? (
          /* Modo detalle: sesiones individuales del advisor con agendados/asistentes */
          <AdvisorScheduleTable
            data={data?.sessionDetails ?? []}
            loading={loading}
            onRowClick={row => setSelectedEventId(row._id)}
            filters={{ fechaInicio, fechaFin }}
            exportPermission={InformesPermission.ADV_RESUMEN_EXP}
          />
        ) : (
          /* Modo resumen: tabla consolidada por advisor */
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
                      {['#','Advisor','Sesiones','Jumps','Training','Clubes','Essential','Welcome','Total','Inscritos','Asistentes','% Asist.'].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.table.map((row, i) => {
                      const pct = row.totalInscritos > 0
                        ? Math.round((row.totalAsistentes / row.totalInscritos) * 10000) / 100 : 0
                      return (
                        <tr key={row.advisorId ?? i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[160px] truncate" title={row.advisorNombre}>{row.advisorNombre}</td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{row.totalSesiones}</span></td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-semibold">{row.totalJumps}</span></td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full text-xs font-semibold">{row.totalTraining}</span></td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">{row.totalClubes}</span></td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-full text-xs font-semibold">{row.totalEssential}</span></td>
                          <td className="px-3 py-2.5 text-center"><span className="px-2 py-0.5 bg-purple-100 text-purple-600 rounded-full text-xs font-semibold">{row.totalWelcome}</span></td>
                          <td className="px-3 py-2.5 text-right font-bold text-gray-900">{row.totalGeneral}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{row.totalInscritos}</td>
                          <td className="px-3 py-2.5 text-right text-green-600 font-medium">{row.totalAsistentes}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`font-semibold ${pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{pct}%</span>
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

      </div>

      {/* Session detail modal — solo en modo advisor */}
      <AdvisorSessionDetailModal
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
      />
    </DashboardLayout>
  )
}
