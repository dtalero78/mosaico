'use client'

import { useState, useCallback, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { useSession } from 'next-auth/react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList
} from 'recharts'
import { MagnifyingGlassIcon, PrinterIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'

const today       = new Date().toISOString().split('T')[0]
const NIVEL_ORDER = ['ESS','BN1','BN2','BN3','P1','P2','P3','F1','F2','F3']
const NIVEL_COLORS: Record<string,string> = {
  ESS:'#6366f1', BN1:'#3b82f6', BN2:'#10b981', BN3:'#f59e0b',
  P1:'#ef4444',  P2:'#8b5cf6', P3:'#06b6d4',
  F1:'#f97316',  F2:'#ec4899', F3:'#84cc16',
}

// ── ISO week → Monday date ─────────────────────────────────────────────────
function isoWeekToMonday(weekStr: string): Date {
  const [yearStr, wStr] = weekStr.split('-W')
  const year = parseInt(yearStr), week = parseInt(wStr)
  const jan4 = new Date(year, 0, 4)
  const dow = jan4.getDay() || 7
  const monday = new Date(jan4)
  monday.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7)
  return monday
}

function weekLabel(semana: string): string {
  const d = isoWeekToMonday(semana)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// ── Heatmap helpers ────────────────────────────────────────────────────────
function HeatmapCell({ count, max, date }: { count: number; max: number; date: string }) {
  const intensity = max > 0 ? count / max : 0
  const bg = intensity === 0 ? '#f3f4f6'
    : intensity < 0.25 ? '#bfdbfe'
    : intensity < 0.5  ? '#60a5fa'
    : intensity < 0.75 ? '#3b82f6'
    : '#1d4ed8'
  const label = date
    ? `${new Date(date + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}: ${count} agendamiento(s)`
    : `${count} agendamientos`
  return (
    <div title={label}
      style={{ backgroundColor: bg, width: 12, height: 12, borderRadius: 2, margin: 1 }} />
  )
}

const DAY_LABELS = ['L','M','X','J','V','S','D']

export default function InfoAcademicUserPage() {
  const { data: session } = useSession()
  const [numeroId,    setNumeroId]    = useState('')
  const [startDate,   setStartDate]   = useState('')
  const [endDate,     setEndDate]     = useState(today)
  const [nivel,       setNivel]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [data,        setData]        = useState<any>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [showModal,   setShowModal]   = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

  const handleSearch = useCallback(async () => {
    if (!numeroId.trim()) { setError('Ingrese el número de ID'); return }
    setLoading(true); setError(null); setData(null); setShowModal(false)
    try {
      const qs = new URLSearchParams({ numeroId: numeroId.trim() })
      if (startDate) qs.set('startDate', startDate)
      if (endDate)   qs.set('endDate',   endDate)
      if (nivel)     qs.set('nivel',     nivel)
      const res  = await fetch(`/api/postgres/reports/academic-user?${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Error')
      if (json.total === 0) { setData(json); setShowModal(true); return }
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [numeroId, startDate, endDate, nivel])

  const handleClear = () => {
    setNumeroId(''); setStartDate(''); setEndDate(today); setNivel(''); setData(null); setError(null)
  }

  const handleCSV = () => {
    if (!data) return
    exportToExcel(data.records, [
      { header: 'Fecha',     accessor: (r: any) => r.fechaEvento ? new Date(r.fechaEvento).toLocaleString('es-CO') : '' },
      { header: 'Tipo',      accessor: (r: any) => r.tipo || '' },
      { header: 'Advisor',   accessor: (r: any) => r.advisor || '' },
      { header: 'Nivel',     accessor: (r: any) => r.nivel || '' },
      { header: 'Step',      accessor: (r: any) => r.step || '' },
      { header: 'Asistió',   accessor: (r: any) => (r.asistio || r.asistencia) ? 'Sí' : 'No' },
      { header: 'Participó', accessor: (r: any) => r.participacion ? 'Sí' : '—' },
      { header: 'Canceló',   accessor: (r: any) => r.cancelo ? 'Sí' : '—' },
      { header: 'No Aprobó', accessor: (r: any) => r.noAprobo ? 'Sí' : '—' },
    ], `reporte_academico_${data.student?.numeroId}_${today}`)
  }

  const handlePrint = () => {
    // Tip: in print dialog, disable "Headers and footers" to hide URL/date
    window.print()
  }

  const heatmapMax = data ? Math.max(...(data.heatmap || []).map((h: any) => h.count), 1) : 1

  // Distribución semanal con etiqueta legible y total por semana
  const distribucionWithLabel = (data?.distribucionSemanal || []).map((d: any) => {
    const total = NIVEL_ORDER.reduce((s: number, nv: string) => s + (d[nv] || 0), 0)
    return { ...d, semanaLabel: weekLabel(d.semana), __total__: 0, __totalVal__: total }
  })

  // Build heatmap weeks grid (last 52 weeks)
  const heatmapGrid = (() => {
    if (!data?.heatmap) return []
    const map: Record<string, number> = {}
    data.heatmap.forEach((h: any) => { map[h.date] = h.count })
    const weeks: { week: string; days: { date: string; count: number }[] }[] = []
    const now = new Date(); const start = new Date(now)
    start.setDate(start.getDate() - 363)
    let cur = new Date(start)
    while (cur.getDay() !== 1) cur.setDate(cur.getDate() - 1)
    for (let w = 0; w < 52; w++) {
      const week = { week: cur.toISOString().split('T')[0], days: [] as any[] }
      for (let d = 0; d < 7; d++) {
        const iso = cur.toISOString().split('T')[0]
        week.days.push({ date: iso, count: map[iso] || 0 })
        cur.setDate(cur.getDate() + 1)
      }
      weeks.push(week)
    }
    return weeks
  })()

  return (
    <DashboardLayout>
      {/* Print CSS injected inline */}
      <style>{`
        @media print {
          /* Hide everything UI-related */
          .no-print,
          [data-sonner-toaster],
          [data-testid="toast"],
          .toast,
          #__next > div > div:last-child,
          footer,
          nav { display: none !important; }

          .print-header { display: flex !important; }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            background: white !important;
          }

          .print-page { page-break-inside: avoid; }

          @page {
            size: letter portrait;
            margin: 12mm 15mm 12mm 15mm;
          }

          /* Watermark */
          .watermark::after {
            content: '';
            position: fixed; top: 50%; left: 50%;
            transform: translate(-50%,-50%) rotate(-25deg);
            width: 380px; height: 380px;
            background: url('/logo.png') center/contain no-repeat;
            opacity: 0.04; z-index: 0; pointer-events: none;
          }

          /* Avoid table breaks */
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          thead { display: table-header-group; }
        }
        @media screen { .print-header { display: none !important; } }
      `}</style>

      <div className="space-y-5 watermark">

        {/* ── Filters ── */}
        <div className="no-print">
          <div className="flex items-center gap-2 mb-4">
            <h1 className="text-xl font-bold text-gray-900">InfoAcademic User</h1>
            <span className="text-sm text-gray-500">Reporte académico individual</span>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="iau-id" className="block text-xs text-gray-500 mb-1">Número de ID *</label>
                <input id="iau-id" type="text" value={numeroId}
                  onChange={e => setNumeroId(e.target.value.replace(/[^A-Z0-9]/g,'').toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Ej: 255667637"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                />
              </div>
              <div>
                <label htmlFor="iau-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
                <input id="iau-start" type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="iau-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
                <input id="iau-end" type="date" value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="iau-nivel" className="block text-xs text-gray-500 mb-1">Nivel</label>
                <select id="iau-nivel" value={nivel} onChange={e => setNivel(e.target.value)}
                  title="Filtrar por nivel"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Todos los niveles</option>
                  {NIVEL_ORDER.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={handleClear}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                  Limpiar filtros
                </button>
                <button type="button" onClick={handleSearch} disabled={loading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  <MagnifyingGlassIcon className="h-4 w-4" />
                  {loading ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>

        {/* ── Report content ── */}
        {data && data.total > 0 && (
          <div ref={reportRef}>

            {/* Print header (only visible when printing) */}
            <div className="print-header items-start justify-between mb-6 pb-4 border-b-2 border-blue-600">
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="LGS" className="h-14 w-auto" />
                <div>
                  <p className="text-xs text-gray-500">Let's Go Speak — Plataforma Académica</p>
                  <p className="text-xs text-gray-400">Generado: {new Date().toLocaleString('es-CO')} · Por: {session?.user?.name || session?.user?.email}</p>
                </div>
              </div>
              <div className="text-right">
                <h1 className="text-lg font-bold text-gray-900">
                  Reporte Académico — {data.student.nombre}
                </h1>
                <p className="text-sm text-gray-600">ID: {data.student.numeroId} · {startDate || 'Inicio'} → {endDate}</p>
              </div>
            </div>

            {/* Web header */}
            <div className="no-print bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="LGS" className="h-12 w-auto" />
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Reporte Académico — {data.student.nombre}
                  </h2>
                  <p className="text-sm text-gray-500">
                    ID: {data.student.numeroId} · Nivel actual: {data.student.nivel} {data.student.step} ·
                    Plataforma: {data.student.plataforma} ·
                    Período: {startDate || 'Inicio'} → {endDate}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Generado: {new Date().toLocaleString('es-CO')} · Por: {session?.user?.name}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
                  <ArrowDownTrayIcon className="h-4 w-4" /> CSV
                </button>
                <button type="button" onClick={handlePrint}
                  title="En el diálogo de impresión, desactive 'Encabezados y pies de página' para ocultar la URL del navegador"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <PrinterIcon className="h-4 w-4" /> Imprimir / PDF
                </button>
              </div>
            </div>

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 print-page">
              {[
                { label: 'Total Agendamientos', value: data.kpis.total, color: '#3b82f6' },
                { label: 'Asistidas', value: data.kpis.asistidas, color: '#10b981' },
                { label: 'No Asistidas', value: data.kpis.noAsistidas, color: '#ef4444' },
                { label: 'Canceladas', value: data.kpis.canceladas, color: '#f59e0b' },
                { label: 'Jumps Aprobados', value: data.kpis.jumpsAprobados, color: '#8b5cf6' },
              ].map(k => (
                <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
                  <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value.toLocaleString()}</p>
                </div>
              ))}
            </div>

            {/* ── Weekly distribution last 3 months ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 print-page">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">
                Distribución por Semana — Últimos 3 meses
              </h3>
              <p className="text-xs text-gray-400 mb-4">Agendamientos semanales por nivel</p>
              {distribucionWithLabel.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={distribucionWithLabel} margin={{ top:20, right:12, bottom:0, left:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="semanaLabel" tick={{ fontSize: 10, fill:'#9ca3af' }} />
                    <YAxis tick={{ fontSize: 10, fill:'#9ca3af' }} width={28} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: any, name: string) => [value, name]}
                      labelFormatter={(label: string, payload: any[]) => {
                        if (!payload?.length) return label
                        const semana = payload[0]?.payload?.semana || ''
                        return `${label}  (${semana})`
                      }}
                    />
                    <Legend />
                    {NIVEL_ORDER.filter(nv =>
                      distribucionWithLabel.some((d: any) => d[nv])
                    ).map((nv, idx, arr) => (
                      <Bar key={nv} dataKey={nv} stackId="a" fill={NIVEL_COLORS[nv] || '#9ca3af'} maxBarSize={36}>
                        {idx === arr.length - 1 && (
                          <LabelList
                            content={(props: any) => {
                              const { x, y, width, index } = props
                              const total = distribucionWithLabel[index]?.__totalVal__ || 0
                              if (!total) return null
                              return (
                                <text
                                  key={index}
                                  x={(x || 0) + (width || 0) / 2}
                                  y={(y || 0) - 5}
                                  textAnchor="middle"
                                  fontSize={10}
                                  fontWeight={600}
                                  fill="#374151"
                                >
                                  {total}
                                </text>
                              )
                            }}
                          />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">Sin datos en los últimos 3 meses</p>
              )}
            </div>

            {/* ── Program Progress ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 print-page">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Progreso del Programa</h3>
              <p className="text-xs text-gray-400 mb-5">Avance por nivel · basado en 12 meses total</p>
              <div className="space-y-3">
                {data.progresaPrograma.map((p: any) => {
                  const barPct = Math.min(p.pct, 100)
                  const displayPct = p.pct
                  return (
                    <div key={p.nivel} className="flex items-center gap-3">
                      <span className="text-xs font-semibold w-8 flex-shrink-0" style={{ color: NIVEL_COLORS[p.nivel] || '#6b7280' }}>
                        {p.nivel}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden relative">
                        <div className="h-5 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                          style={{
                            width: barPct > 0 ? `${Math.max(barPct, 3)}%` : '0%',
                            backgroundColor: NIVEL_COLORS[p.nivel] || '#9ca3af',
                          }}>
                          {barPct > 18 && (
                            <span className="text-white text-xs font-semibold">{displayPct}%</span>
                          )}
                        </div>
                        {barPct <= 18 && barPct > 0 && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-700">{displayPct}%</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 w-52 flex-shrink-0">
                        {p.hasData ? (
                          <span>
                            <span className="font-medium text-gray-700">{p.sesionesEfectivas}</span> ses
                            <span className="mx-1 text-gray-300">·</span>
                            <span className="font-medium text-gray-700">{p.completedSteps}/{p.totalSteps}</span> steps
                            <span className="mx-1 text-gray-300">·</span>
                            <span className="font-medium text-gray-700">{p.diasEnNivel}</span> días
                          </span>
                        ) : (
                          <span className="text-gray-300">Sin datos</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex gap-6 text-xs text-gray-500">
                <span>Nivel más agendado: <strong className="text-gray-700">{data.nivelMasAgendado}</strong></span>
                {data.nivelMasTiempo && (
                  <span>Nivel con más tiempo: <strong className="text-gray-700">{data.nivelMasTiempo.nivel}</strong> ({data.nivelMasTiempo.diasEnNivel} días)</span>
                )}
              </div>
            </div>

            {/* ── Heatmap ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 print-page">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-1">Mapa de Calor — Actividad</h3>
              <p className="text-xs text-gray-400 mb-4">Últimas 52 semanas · cada celda = 1 día</p>
              <div className="overflow-x-auto">
                <div className="flex gap-0">
                  {/* Columna etiquetas días */}
                  <div className="flex flex-col mr-1" style={{ marginTop: 18 }}>
                    {DAY_LABELS.map((d, i) => (
                      <div key={i} style={{ width: 14, height: 14, display: 'flex', alignItems: 'center' }}>
                        {[0, 2, 4].includes(i) && (
                          <span style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1 }}>{d}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Semanas: mes encima + celdas */}
                  <div>
                    {/* Fila etiquetas de mes */}
                    <div className="flex gap-0.5 mb-0.5" style={{ height: 16 }}>
                      {heatmapGrid.map((week, wi) => {
                        const mon = new Date(week.week + 'T12:00:00')
                        const prevMon = wi > 0 ? new Date(heatmapGrid[wi - 1].week + 'T12:00:00') : null
                        const showMonth = !prevMon || mon.getMonth() !== prevMon.getMonth()
                        return (
                          <div key={wi} style={{ width: 14, flexShrink: 0 }}>
                            {showMonth && (
                              <span style={{ fontSize: 9, color: '#6b7280', whiteSpace: 'nowrap', fontWeight: 600 }}>
                                {mon.toLocaleDateString('es-CO', { month: 'short' })}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Celdas */}
                    <div className="flex gap-0.5">
                      {heatmapGrid.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-0.5">
                          {week.days.map((day, di) => (
                            <HeatmapCell key={di} count={day.count} max={heatmapMax} date={day.date} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Leyenda */}
                <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                  <span>Menos</span>
                  {['#f3f4f6','#bfdbfe','#60a5fa','#3b82f6','#1d4ed8'].map((c, i) => (
                    <div key={i} style={{ backgroundColor: c, width: 12, height: 12, borderRadius: 2 }} />
                  ))}
                  <span>Más</span>
                </div>
              </div>
            </div>

            {/* ── Detail Table ── */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden print-page">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Detalle de Agendamientos</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{data.total} registros</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {['FECHA','TIPO','ADVISOR','NIVEL','STEP','ASISTIÓ','PARTICIPÓ','CANCELÓ','NO APROBÓ'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-50">
                    {data.records.map((r: any) => {
                      const asistio = r.asistio || r.asistencia
                      return (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {r.fechaEvento ? new Date(r.fechaEvento).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' }) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold
                              ${r.tipo==='SESSION' ? 'bg-blue-100 text-blue-800'
                              : r.tipo==='CLUB'    ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-700'}`}>
                              {r.tipo || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-blue-600 whitespace-nowrap">{r.advisor || '—'}</td>
                          <td className="px-3 py-2">
                            <span className="font-semibold" style={{ color: NIVEL_COLORS[r.nivel] || '#6b7280' }}>{r.nivel || '—'}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{r.step || '—'}</td>
                          <td className="px-3 py-2 font-medium" style={{ color: asistio ? '#10b981' : '#ef4444' }}>{asistio ? 'Sí' : 'No'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.participacion ? 'Sí' : '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.cancelo ? 'Sí' : '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.noAprobo ? 'Sí' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── No data modal ── */}
        {showModal && data && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 no-print">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-center">
              <div className="text-4xl mb-3">📋</div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Sin agendamientos</h2>
              <p className="text-sm text-gray-600 mb-1">
                No se encontraron agendamientos para:
              </p>
              <p className="text-sm font-semibold text-blue-600 mb-4">{data.student?.nombre}</p>
              <p className="text-xs text-gray-400 mb-5">ID: {data.student?.numeroId} · Período: {startDate || 'Inicio'} → {endDate}</p>
              <button type="button" onClick={() => setShowModal(false)}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                Aceptar
              </button>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  )
}
