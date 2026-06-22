'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ArrowDownTrayIcon, PrinterIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

interface MatriculasData {
  cards: {
    xAprobar: number; vigentes: number; finalizados: number
    beneficiarios: number; academicosActivos: number; academicosOnHold: number; academicosInactivos: number
  }
  barPendientes: { name: string; value: number }[]
  donut: { name: string; value: number }[]
  heatmap: {
    months: { ym: string; label: string }[]
    paises: string[]
    data: { pais: string; ym: string; n: number }[]
    lgs: { ym: string; n: number }[]
  }
  meta: { paises: string[]; startDate: string; endDate: string; pais: string | null }
}

const BAR_COLORS = ['#fbbf24', '#f97316', '#ef4444']
const DONUT_COLORS: Record<string, string> = { 'aprobadas (sin finalizar)': '#22c55e', 'sin aprobar': '#f59e0b' }
const today       = new Date().toISOString().substring(0, 10)
const firstOfYear = `${new Date().getFullYear()}-01-01`

function Card({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1 print-page">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
  const r = 55, cx = 70, cy = 70, sw = 22, circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-4 flex-wrap justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140" className="flex-shrink-0">
        {data.map((seg, i) => {
          const pct = seg.value / total, dash = pct * circ, rot = offset * 360 - 90
          offset += pct
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={DONUT_COLORS[seg.name.toLowerCase()] ?? '#9ca3af'} strokeWidth={sw}
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="butt" transform={`rotate(${rot} ${cx} ${cy})`} />
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="17" fontWeight="bold" fill="#1f2937">{total.toLocaleString()}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#6b7280">MATRÍCULAS</text>
      </svg>
      <div className="space-y-1.5">
        {data.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: DONUT_COLORS[seg.name.toLowerCase()] ?? '#9ca3af' }} />
            <span className="text-gray-600 w-36">{seg.name}</span>
            <span className="font-semibold text-gray-900 w-12 text-right">{seg.value.toLocaleString()}</span>
            <span className="text-gray-400">{((seg.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MatriculasPage() {
  const { data: session } = useSession()
  const [startDate, setStartDate] = useState(firstOfYear)
  const [endDate, setEndDate]     = useState(today)
  const [pais, setPais]           = useState('')
  const [data, setData]           = useState<MatriculasData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const fetchData = useCallback(async (sd: string, ed: string, p: string) => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams({ startDate: sd, endDate: ed })
      if (p) qs.set('pais', p)
      const res = await fetch(`/api/postgres/reports/contratos/matriculas?${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Error al cargar datos')
      setData({ cards: json.cards, barPendientes: json.barPendientes, donut: json.donut, heatmap: json.heatmap, meta: json.meta })
    } catch (e: any) { setError(e.message || 'Error inesperado') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData(firstOfYear, today, '') }, [fetchData])

  const handleApply = () => fetchData(startDate, endDate, pais)
  const handleClear = () => { setStartDate(firstOfYear); setEndDate(today); setPais(''); fetchData(firstOfYear, today, '') }
  const handlePrint = () => window.print()

  const c = data?.cards
  const heatMax = useMemo(() => Math.max(1,
    ...(data?.heatmap.data ?? []).map(d => d.n),
  ), [data])
  const lgsMax = useMemo(() => Math.max(1, ...(data?.heatmap.lgs ?? []).map(d => d.n)), [data])
  const heatLookup = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data?.heatmap.data ?? []) m.set(`${d.pais}-${d.ym}`, d.n)
    return m
  }, [data])
  const lgsLookup = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data?.heatmap.lgs ?? []) m.set(d.ym, d.n)
    return m
  }, [data])
  const colorFor = (v: number, max: number) => {
    if (v <= 0) return '#f8fafc'
    const t = v / max, mix = (a: number, b: number) => Math.round(a + (b - a) * t)
    return `rgb(${mix(0xdb, 0x1d)},${mix(0xea, 0x4e)},${mix(0xfe, 0xd8)})`
  }
  const heatColor = (v: number) => colorFor(v, heatMax)
  const lgsColor  = (v: number) => colorFor(v, lgsMax)

  const handleCSV = () => {
    if (!c) return
    const rows: { seccion: string; metrica: string; valor: number | string }[] = [
      { seccion: 'Filtros', metrica: 'País', valor: pais || 'Todos' },
      { seccion: 'Filtros', metrica: 'Período', valor: `${startDate} → ${endDate}` },
      { seccion: 'Contratos', metrica: 'x Aprobar', valor: c.xAprobar },
      { seccion: 'Contratos', metrica: 'Vigentes', valor: c.vigentes },
      { seccion: 'Contratos', metrica: 'Finalizados', valor: c.finalizados },
      { seccion: 'Personas', metrica: 'Beneficiarios', valor: c.beneficiarios },
      { seccion: 'Personas', metrica: 'Académicos Activos', valor: c.academicosActivos },
      { seccion: 'Personas', metrica: 'Académicos OnHold', valor: c.academicosOnHold },
      { seccion: 'Personas', metrica: 'Académicos Inactivos', valor: c.academicosInactivos },
      ...(data?.barPendientes ?? []).map(b => ({ seccion: 'Pendientes por antigüedad', metrica: b.name, valor: b.value })),
      ...(data?.heatmap.data ?? []).map(h => ({ seccion: 'Aprobadas (12 meses)', metrica: `${h.pais} · ${h.ym}`, valor: h.n })),
      ...(data?.heatmap.lgs ?? []).map(h => ({ seccion: 'Aprobadas LGS (compañía)', metrica: h.ym, valor: h.n })),
    ]
    exportToExcel(rows, [
      { header: 'Sección', accessor: r => r.seccion },
      { header: 'Métrica', accessor: r => r.metrica },
      { header: 'Valor',   accessor: r => r.valor },
    ], `matriculas_${startDate}_${endDate}${pais ? '_' + pais : ''}`)
  }

  return (
    <DashboardLayout>
      <style>{`
        @media print {
          .no-print, [data-sonner-toaster], nav, footer { display: none !important; }
          .print-header { display: flex !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff !important; }
          .print-page { page-break-inside: avoid; }
          @page { size: letter portrait; margin: 12mm 14mm; }
          .watermark::after {
            content: ''; position: fixed; top: 50%; left: 50%;
            transform: translate(-50%,-50%) rotate(-25deg);
            width: 380px; height: 380px; background: url('/logo.png') center/contain no-repeat;
            opacity: 0.04; z-index: 0; pointer-events: none;
          }
        }
        @media screen { .print-header { display: none !important; } }
      `}</style>

      <div className="space-y-5 pb-10 watermark">

        {/* Print-only header */}
        <div className="print-header items-start justify-between mb-6 pb-4 border-b-2 border-indigo-600">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="MOSAICO" className="h-14 w-auto" />
            <div>
              <p className="text-xs text-gray-500">MOSAICO — Informe de Matrículas</p>
              <p className="text-xs text-gray-400">Generado: {new Date().toLocaleString('es-CO')} · Por: {session?.user?.name || session?.user?.email}</p>
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold text-gray-900">Matrículas</h1>
            <p className="text-sm text-gray-600">{pais || 'Todos los países'} · {startDate} → {endDate}</p>
          </div>
        </div>

        {/* Header + filtros (web) */}
        <div className="no-print">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="MOSAICO" className="h-10 w-auto" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Matrículas</h1>
                <p className="text-sm text-gray-500">Estado de contratos: por aprobar, vigentes, finalizados y usuarios académicos.</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="m-pais" className="block text-xs text-gray-500 mb-1">País</label>
                <select id="m-pais" value={pais} onChange={e => setPais(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]">
                  <option value="">Todos</option>
                  {(data?.meta?.paises ?? []).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="m-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
                <input id="m-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="m-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
                <input id="m-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-2 ml-auto flex-wrap">
                <button type="button" onClick={handleApply} disabled={loading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
                <button type="button" onClick={handleClear} disabled={loading}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Limpiar filtros</button>
                <PermissionGuard permission={InformesPermission.CONTRATOS_MATRICULAS_EXP}>
                  <button type="button" onClick={handleCSV} disabled={loading || !c}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                    <ArrowDownTrayIcon className="h-4 w-4" /> CSV
                  </button>
                </PermissionGuard>
                <PermissionGuard permission={InformesPermission.CONTRATOS_MATRICULAS_PDF}>
                  <button type="button" onClick={handlePrint} disabled={loading || !c}
                    title="En el diálogo de impresión, desactive 'Encabezados y pies de página' para ocultar la URL del navegador"
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    <PrinterIcon className="h-4 w-4" /> Imprimir / PDF
                  </button>
                </PermissionGuard>
              </div>
            </div>
          </div>
        </div>

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 no-print">
            {error}<button type="button" onClick={handleApply} className="ml-4 text-xs underline">Reintentar</button>
          </div>
        )}

        {/* Tarjetas — Contratos (afectadas por país + rango de fechas) */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Contratos ({startDate} → {endDate})</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card label="Contratos x Aprobar" value={c?.xAprobar ?? 0} color="#f59e0b" hint="Titulares no aprobados (incl. rechazados/devueltos)" />
            <Card label="Contratos Vigentes" value={c?.vigentes ?? 0} color="#22c55e" hint="Aprobados, no finalizados" />
            <Card label="Contratos Finalizados" value={c?.finalizados ?? 0} color="#ef4444" hint="Estado FINALIZADA" />
          </div>
        </div>

        {/* Tarjetas — Personas / Académicos (estado actual; sólo país) */}
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Personas y académicos (estado actual)</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card label="Beneficiarios" value={c?.beneficiarios ?? 0} color="#3b82f6" hint="Total de beneficiarios" />
            <Card label="Académicos Activos" value={c?.academicosActivos ?? 0} color="#0ea5e9" hint="Step 0–49, no inactivos" />
            <Card label="En OnHold" value={c?.academicosOnHold ?? 0} color="#a855f7" hint="Estudiantes pausados" />
            <Card label="Académicos Inactivos" value={c?.academicosInactivos ?? 0} color="#9ca3af" hint="Step 50 (DONE)" />
          </div>
        </div>

        {/* Barras + Dona */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-page">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Matrículas pendientes por antigüedad</h3>
            <p className="text-xs text-gray-400 mb-4">Titulares sin aprobar según el tiempo transcurrido</p>
            {loading ? <div className="h-56 bg-gray-100 rounded animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.barPendientes ?? []} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [v, 'Titulares']} />
                  <Bar dataKey="value" name="Titulares" radius={[4, 4, 0, 0]}>
                    {(data?.barPendientes ?? []).map((_d, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-page">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Aprobadas vs Sin aprobar</h3>
            {loading ? <div className="h-48 bg-gray-100 rounded animate-pulse" /> : <DonutChart data={data?.donut ?? []} />}
          </div>
        </div>

        {/* Heatmaps: izq por país (12 meses móviles) + der consolidado LGS */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Izquierda: por país × mes (ventana de 12 meses hacia atrás desde la fecha final) */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-page">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Matrículas aprobadas por país y mes</h3>
            <p className="text-xs text-gray-400 mb-4">Últimos 12 meses hasta {endDate} — mes de inicio del contrato</p>
            {loading ? <div className="h-40 bg-gray-100 rounded animate-pulse" />
              : !(data?.heatmap.paises.length) ? <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
              : (
                <div className="overflow-x-auto">
                  <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                      <tr>
                        <th className="text-left font-medium text-gray-400 pr-2">País</th>
                        {data!.heatmap.months.map(m => <th key={m.ym} className="font-medium text-gray-400 w-10 text-center">{m.label}</th>)}
                        <th className="font-semibold text-gray-500 w-12 text-center pl-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.heatmap.paises.map(p => {
                        const rowTotal = data!.heatmap.months.reduce((s, m) => s + (heatLookup.get(`${p}-${m.ym}`) ?? 0), 0)
                        return (
                          <tr key={p}>
                            <td className="pr-2 text-gray-700 whitespace-nowrap">{p}</td>
                            {data!.heatmap.months.map(m => {
                              const v = heatLookup.get(`${p}-${m.ym}`) ?? 0
                              return (
                                <td key={m.ym} className="w-10 h-9 text-center align-middle rounded"
                                  style={{ backgroundColor: heatColor(v), color: v / heatMax > 0.55 ? '#fff' : '#374151' }}
                                  title={`${p} · ${m.label}: ${v}`}>{v > 0 ? v : ''}</td>
                              )
                            })}
                            <td className="w-12 text-center font-semibold text-gray-700 pl-2">{rowTotal.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {/* Derecha: consolidado LGS (toda la compañía) por mes */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 print-page">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Consolidado LGS</h3>
            <p className="text-xs text-gray-400 mb-4">Toda la compañía — últimos 12 meses</p>
            {loading ? <div className="h-40 bg-gray-100 rounded animate-pulse" />
              : !(data?.heatmap.lgs.length) ? <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
              : (
                <div className="space-y-1">
                  {data!.heatmap.months.map(m => {
                    const v = lgsLookup.get(m.ym) ?? 0
                    return (
                      <div key={m.ym} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-14 flex-shrink-0">{m.label}</span>
                        <div className="flex-1 h-6 rounded flex items-center justify-end px-2"
                          style={{ backgroundColor: lgsColor(v), color: v / lgsMax > 0.55 ? '#fff' : '#374151' }}>
                          <span className="text-xs font-semibold">{v > 0 ? v.toLocaleString() : ''}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-2 border-t-2 border-gray-200 pt-1.5 mt-1.5">
                    <span className="text-xs font-bold text-gray-700 w-14 flex-shrink-0">Total</span>
                    <span className="text-sm font-bold text-indigo-700">
                      {(data!.heatmap.lgs.reduce((s, x) => s + x.n, 0)).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
