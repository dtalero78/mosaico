'use client'

import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

// ── Types ──────────────────────────────────────────────────────────────────
interface NivelRow  { nivel: string; total: number }
interface DiaRow    { dow: number;   total: number }
interface ClubesRow { tipo_club: string; total: number }

interface NivelesResponse {
  sesionesPorNivel: NivelRow[]
  sesionesPorDia:   DiaRow[]
  jumpsPorNivel:    NivelRow[]
  clubesPorTipo:    ClubesRow[]
  sesionesSemana:   NivelRow[]
  jumpsSemana:      NivelRow[]
  clubesSemana:     ClubesRow[]
  weekStart: string
  weekEnd:   string
}

// ── Constants ──────────────────────────────────────────────────────────────
const today       = new Date().toISOString().split('T')[0]
const firstOfYear = `${new Date().getFullYear()}-01-01`

const DIAS_FULL  = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const NIVEL_ORDER = ['BN1','BN2','BN3','P1','P2','P3','F1','F2','F3','F4','ESS','DONE']

const sortNiveles = (arr: NivelRow[]) =>
  [...arr].sort((a, b) => {
    const ia = NIVEL_ORDER.indexOf(a.nivel), ib = NIVEL_ORDER.indexOf(b.nivel)
    if (ia === -1 && ib === -1) return a.nivel.localeCompare(b.nivel)
    if (ia === -1) return 1; if (ib === -1) return -1
    return ia - ib
  })

const COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#ec4899','#84cc16','#6366f1','#14b8a6','#a855f7']
const colOf  = (i: number) => COLORS[i % COLORS.length]

const CLUB_COLORS: Record<string,string> = {
  TRAINING:'#3b82f6', GRAMMAR:'#10b981', PRONUNCIATION:'#f59e0b',
  LISTENING:'#8b5cf6', KARAOKE:'#ef4444', CONVERSATION:'#06b6d4', OTRO:'#9ca3af',
}

function barFill(value: number, max: number): string {
  if (max === 0) return '#bfdbfe'
  const r = value / max
  if (r > 0.85) return '#1d4ed8'
  if (r > 0.65) return '#3b82f6'
  if (r > 0.45) return '#60a5fa'
  if (r > 0.25) return '#93c5fd'
  return '#bfdbfe'
}

const ALL_NIVELES = ['BN1','BN2','BN3','P1','P2','P3','F1','F2','F3','F4','ESS']

// ── Sub-components ─────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold leading-tight" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      <p className="text-blue-600 font-bold">{payload[0].value.toLocaleString()} agendamientos</p>
    </div>
  )
}

function HBar({ label, total, max, color, pct }: { label: string; total: number; max: number; color: string; pct: string }) {
  const width = max > 0 ? Math.max((total / max) * 100, 2) : 2
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-gray-600 w-24 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
        <div className="h-6 rounded-full flex items-center justify-end pr-2.5 transition-all duration-500"
          style={{ width: `${width}%`, backgroundColor: color }}>
          {width > 22 && <span className="text-white text-xs font-semibold">{total.toLocaleString()}</span>}
        </div>
        {width <= 22 && total > 0 && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700">
            {total.toLocaleString()}
          </span>
        )}
      </div>
      <span className="text-xs text-gray-400 w-10 flex-shrink-0 text-right">{pct}%</span>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function NivelesPage() {
  const [startDate,   setStartDate]   = useState(firstOfYear)
  const [endDate,     setEndDate]     = useState(today)
  const [nivelFiltro, setNivelFiltro] = useState('')
  const [data,        setData]        = useState<NivelesResponse | null>(null)
  const [loading,     setLoading]     = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      if (nivelFiltro) qs.set('nivel', nivelFiltro)
      const res  = await fetch(`/api/postgres/reports/estadisticas/niveles?${qs}`)
      const json = await res.json()
      if (json.success) setData(json)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [startDate, endDate, nivelFiltro])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived ────────────────────────────────────────────────────────────
  const sesiones    = sortNiveles(data?.sesionesPorNivel ?? [])
  const maxSes      = Math.max(...sesiones.map(r => r.total), 1)
  const totalSes    = sesiones.reduce((s, r) => s + r.total, 0)
  const nivelPico   = [...sesiones].sort((a,b) => b.total - a.total)[0]

  const diaChart  = Array.from({ length: 7 }, (_, i) => {
    const dow = i + 1
    const row = data?.sesionesPorDia.find(r => r.dow === dow)
    return { dia: DIAS_FULL[dow], total: row?.total ?? 0, dow }
  })
  const maxDia    = Math.max(...diaChart.map(d => d.total), 1)
  const totalDia  = diaChart.reduce((s, d) => s + d.total, 0)
  const diaPico   = [...diaChart].sort((a,b) => b.total - a.total)[0]

  const jumps      = sortNiveles(data?.jumpsPorNivel ?? [])
  const maxJumps   = Math.max(...jumps.map(r => r.total), 1)
  const totalJumps = jumps.reduce((s, r) => s + r.total, 0)

  const clubes      = data?.clubesPorTipo ?? []
  const totalClubes = clubes.reduce((s, r) => s + r.total, 0)
  const clubePico   = [...clubes].sort((a,b) => b.total - a.total)[0]

  // Semana
  const sesSemana   = sortNiveles(data?.sesionesSemana ?? [])
  const jumpsSemana = sortNiveles(data?.jumpsSemana    ?? [])
  const clubsSemana = data?.clubesSemana ?? []
  const totalSesSem  = sesSemana.reduce((s,r)  => s + r.total, 0)
  const totalJumpSem = jumpsSemana.reduce((s,r) => s + r.total, 0)
  const totalClubSem = clubsSemana.reduce((s,r) => s + r.total, 0)
  const maxSesSem    = Math.max(...sesSemana.map(r => r.total),   1)
  const maxJumpSem   = Math.max(...jumpsSemana.map(r => r.total), 1)
  const maxClubSem   = Math.max(...clubsSemana.map(r => r.total), 1)

  // ── CSV ───────────────────────────────────────────────────────────────
  const handleCSV = () => {
    type Row = { seccion: string; label: string; valor: number | string }
    const rows: Row[] = [
      { seccion: 'Filtro', label: 'Fecha inicial', valor: startDate },
      { seccion: 'Filtro', label: 'Fecha final',   valor: endDate   },
    ]
    sesiones.forEach(r     => rows.push({ seccion: 'Sesiones por Nivel',  label: r.nivel,     valor: r.total }))
    diaChart.forEach(r     => rows.push({ seccion: 'Sesiones por Día',    label: r.dia,        valor: r.total }))
    jumps.forEach(r        => rows.push({ seccion: 'Jumps por Nivel',     label: r.nivel,     valor: r.total }))
    clubes.forEach(r       => rows.push({ seccion: 'Talleres por Tipo',     label: r.tipo_club,  valor: r.total }))
    sesSemana.forEach(r    => rows.push({ seccion: 'Sesiones (semana)',   label: r.nivel,     valor: r.total }))
    jumpsSemana.forEach(r  => rows.push({ seccion: 'Jumps (semana)',      label: r.nivel,     valor: r.total }))
    clubsSemana.forEach(r  => rows.push({ seccion: 'Talleres (semana)',     label: r.tipo_club,  valor: r.total }))
    exportToExcel(rows, [
      { header: 'Sección',         accessor: r => r.seccion },
      { header: 'Nivel / Tipo',    accessor: r => r.label   },
      { header: 'Agendamientos',   accessor: r => r.valor   },
    ], `estadisticas-niveles_${startDate}_${endDate}`)
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agendamientos por Nivel</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Sesiones, Jumps y Talleres agendados por nivel en el período seleccionado
          </p>
        </div>

        {/* ── Filters ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="niv-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
              <input id="niv-start" type="date" value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="niv-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
              <input id="niv-end" type="date" value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="niv-nivel" className="block text-xs text-gray-500 mb-1">Filtrar por Nivel</label>
              <select id="niv-nivel" value={nivelFiltro}
                onChange={e => setNivelFiltro(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todos los niveles</option>
                {ALL_NIVELES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button"
                onClick={() => { setStartDate(firstOfYear); setEndDate(today); setNivelFiltro('') }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Limpiar filtros
              </button>
              <PermissionGuard permission={InformesPermission.EST_NIVELES_EXP}>
                <button type="button" onClick={handleCSV} disabled={loading}
                  className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Descargar CSV
                </button>
              </PermissionGuard>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Sesiones"
            value={loading ? '—' : totalSes.toLocaleString()}
            sub="en el período" accent="#3b82f6" />
          <KpiCard label="Nivel Pico"
            value={loading || !nivelPico ? '—' : nivelPico.nivel}
            sub={nivelPico ? `${nivelPico.total.toLocaleString()} sesiones` : undefined}
            accent="#1d4ed8" />
          <KpiCard label="Día más Activo"
            value={loading || !diaPico ? '—' : diaPico.dia}
            sub={diaPico ? `${diaPico.total.toLocaleString()} agendamientos` : undefined}
            accent="#7c3aed" />
          <KpiCard label="Taller más Agendado"
            value={loading || !clubePico ? '—' : clubePico.tipo_club}
            sub={clubePico ? `${clubePico.total.toLocaleString()} talleres` : undefined}
            accent="#059669" />
        </div>

        {/* ── Sesiones por Nivel — BarChart ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Sesiones por Nivel</h3>
              <p className="text-xs text-gray-400 mt-0.5">Total de sesiones (SESSION) agendadas por nivel en el período</p>
            </div>
            {loading && <span className="text-xs text-gray-400 animate-pulse">Cargando...</span>}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sesiones} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="nivel" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={40} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="total" radius={[3,3,0,0]} maxBarSize={36}>
                {sesiones.map((_, i) => <Cell key={i} fill={colOf(i)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Pico annotation */}
          {!loading && nivelPico && (
            <div className="mt-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                Nivel pico: {nivelPico.nivel} · {nivelPico.total.toLocaleString()} sesiones
              </span>
            </div>
          )}
        </div>

        {/* ── 2-col: Por Día + Jumps ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Sesiones por día */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Sesiones por Día de la Semana</h3>
            <p className="text-xs text-gray-400 mb-5">Distribución de agendamientos por día</p>
            {loading
              ? <div className="h-52 flex items-center justify-center text-sm text-gray-400 animate-pulse">Cargando...</div>
              : (
                <div className="space-y-3">
                  {diaChart.map(row => (
                    <HBar key={row.dia} label={row.dia} total={row.total} max={maxDia}
                      color={barFill(row.total, maxDia)}
                      pct={totalDia > 0 ? ((row.total / totalDia) * 100).toFixed(1) : '0'} />
                  ))}
                </div>
              )
            }
            {!loading && diaPico && (
              <div className="mt-4 flex justify-center">
                <span className="inline-flex items-center gap-1.5 bg-purple-50 text-purple-700 text-xs font-medium px-3 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                  Día pico: {diaPico.dia} · {diaPico.total.toLocaleString()} agendamientos
                </span>
              </div>
            )}
          </div>

          {/* Jumps por nivel */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Jumps por Nivel</h3>
            <p className="text-xs text-gray-400 mb-5">Sesiones de step múltiplo de 5 por nivel</p>
            {loading
              ? <div className="h-52 flex items-center justify-center text-sm text-gray-400 animate-pulse">Cargando...</div>
              : jumps.length === 0
                ? <div className="h-52 flex items-center justify-center text-sm text-gray-400">Sin datos</div>
                : (
                  <div className="space-y-3">
                    {jumps.map((row, i) => (
                      <HBar key={row.nivel} label={row.nivel} total={row.total} max={maxJumps}
                        color={colOf(i)}
                        pct={totalJumps > 0 ? ((row.total / totalJumps) * 100).toFixed(1) : '0'} />
                    ))}
                  </div>
                )
            }
            {!loading && jumps[0] && (
              <div className="mt-4 flex justify-center">
                <span className="inline-flex items-center gap-1.5 bg-violet-50 text-violet-700 text-xs font-medium px-3 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />
                  Nivel pico Jumps: {[...jumps].sort((a,b) => b.total - a.total)[0].nivel} · {[...jumps].sort((a,b) => b.total - a.total)[0].total.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Clubes por tipo ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Talleres por Tipo</h3>
              <p className="text-xs text-gray-400 mt-0.5">Distribución de talleres agendados por tipo en el período</p>
            </div>
            {!loading && clubePico && (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                Taller pico: {clubePico.tipo_club} · {clubePico.total.toLocaleString()}
              </span>
            )}
          </div>
          {loading
            ? <div className="h-28 flex items-center justify-center text-sm text-gray-400 animate-pulse">Cargando...</div>
            : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {clubes.map(row => {
                  const color = CLUB_COLORS[row.tipo_club] ?? '#9ca3af'
                  const pct   = totalClubes > 0 ? ((row.total / totalClubes) * 100).toFixed(1) : '0'
                  return (
                    <div key={row.tipo_club} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs font-semibold text-gray-700 uppercase">{row.tipo_club}</span>
                      </div>
                      <p className="text-2xl font-bold" style={{ color }}>{row.total.toLocaleString()}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{pct}% del total</p>
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>

        {/* ── Esta Semana ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Esta Semana</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {data ? `${data.weekStart} → ${data.weekEnd}` : '—'}
              </p>
            </div>
            <div className="flex gap-4 text-xs text-gray-500">
              <span><span className="font-bold text-blue-600">{totalSesSem.toLocaleString()}</span> sesiones</span>
              <span><span className="font-bold text-purple-600">{totalJumpSem.toLocaleString()}</span> jumps</span>
              <span><span className="font-bold text-emerald-600">{totalClubSem.toLocaleString()}</span> talleres</span>
            </div>
          </div>
          {loading
            ? <div className="h-32 flex items-center justify-center text-sm text-gray-400 animate-pulse">Cargando...</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-semibold text-blue-600 uppercase mb-3">Sesiones por Nivel</p>
                  <div className="space-y-2">
                    {sesSemana.length === 0
                      ? <p className="text-xs text-gray-400">Sin agendamientos</p>
                      : sesSemana.map((row, i) => (
                          <HBar key={row.nivel} label={row.nivel} total={row.total} max={maxSesSem}
                            color={colOf(i)}
                            pct={totalSesSem > 0 ? ((row.total / totalSesSem) * 100).toFixed(0) : '0'} />
                        ))
                    }
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-purple-600 uppercase mb-3">Jumps por Nivel</p>
                  <div className="space-y-2">
                    {jumpsSemana.length === 0
                      ? <p className="text-xs text-gray-400">Sin jumps esta semana</p>
                      : jumpsSemana.map((row, i) => (
                          <HBar key={row.nivel} label={row.nivel} total={row.total} max={maxJumpSem}
                            color={colOf(i)}
                            pct={totalJumpSem > 0 ? ((row.total / totalJumpSem) * 100).toFixed(0) : '0'} />
                        ))
                    }
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-600 uppercase mb-3">Talleres por Tipo</p>
                  <div className="space-y-2">
                    {clubsSemana.length === 0
                      ? <p className="text-xs text-gray-400">Sin talleres esta semana</p>
                      : clubsSemana.map(row => (
                          <HBar key={row.tipo_club} label={row.tipo_club} total={row.total} max={maxClubSem}
                            color={CLUB_COLORS[row.tipo_club] ?? '#9ca3af'}
                            pct={totalClubSem > 0 ? ((row.total / totalClubSem) * 100).toFixed(0) : '0'} />
                        ))
                    }
                  </div>
                </div>
              </div>
            )
          }
        </div>

        {/* Nota metodológica */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
          <span className="font-semibold">Nota metodológica:</span> Incluye agendamientos con{' '}
          <code className="bg-blue-100 px-1 rounded">fechaAgendamiento</code> no nula y origen{' '}
          <code className="bg-blue-100 px-1 rounded">PANEL_EST</code>,{' '}
          <code className="bg-blue-100 px-1 rounded">POSTGRES</code> o{' '}
          <code className="bg-blue-100 px-1 rounded">COMP</code>.
          Se excluyen sesiones canceladas y nivel <code className="bg-blue-100 px-1 rounded">WELCOME</code>.
          Nivel y step tomados del evento en <code className="bg-blue-100 px-1 rounded">CALENDARIO</code> via JOIN.
          La sección "Esta Semana" muestra siempre la semana actual (lunes–domingo) independientemente del filtro.
        </div>

      </div>
    </DashboardLayout>
  )
}
