'use client'

import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { InformesPermission } from '@/types/permissions'

// ── Types ──────────────────────────────────────────────────────────────
interface PlatRow {
  plataforma: string; total: number; asistieron: number; cancelaron: number
  aprobaron?: number; noAprobaron?: number
}
interface Section {
  total: number; asistieron: number; cancelaron: number
  aprobaron: number; noAprobaron: number
  porPlataforma: PlatRow[]
}
interface XPaisResponse {
  sesiones: Section; jumps: Section; training: Section
  clubes: Section; welcome: Section; complementarias: Section
}

const today       = new Date().toISOString().split('T')[0]
const firstOfYear = `${new Date().getFullYear()}-01-01`

// ── Color palette per platform ─────────────────────────────────────────
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#84cc16',
]
const color = (i: number) => COLORS[i % COLORS.length]

// ── Donut + Legend by platform ─────────────────────────────────────────
function PlatDonut({ rows, metricKey = 'asistieron', metricLabel = 'Asist.', hideAbsences = false }: {
  rows: PlatRow[]; metricKey?: string; metricLabel?: string; hideAbsences?: boolean
}) {
  const metric = (r: PlatRow) => (r as any)[metricKey] ?? 0
  const totalMetric = rows.reduce((s, r) => s + metric(r), 0)
  const r = 50, cx = 65, cy = 65, sw = 20, circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex gap-5 items-start">
      {/* Donut */}
      <svg width="130" height="130" viewBox="0 0 130 130" className="flex-shrink-0">
        {totalMetric === 0
          ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={sw} />
          : rows.map((row, i) => {
              const val  = metric(row)
              const pct  = val / totalMetric
              const dash = pct * circ
              const rot  = offset * 360 - 90; offset += pct
              return (
                <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                  stroke={color(i)} strokeWidth={sw}
                  strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="butt"
                  transform={`rotate(${rot} ${cx} ${cy})`} />
              )
            })
        }
        <text x={cx} y={cy - 7} textAnchor="middle" fontSize="17" fontWeight="bold" fill="#1f2937">
          {totalMetric.toLocaleString()}
        </text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize="8" fill="#6b7280">TOTAL</text>
      </svg>

      {/* Legend table — ancho del contenido (no w-full) para que las columnas
          queden juntas y no se abra un gran espacio entre País y las cifras. */}
      <div className="min-w-0 overflow-x-auto">
        {rows.length === 0
          ? <p className="text-xs text-gray-400 py-6">Sin datos</p>
          : (
            <table className="text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium pb-1.5 pr-6">País</th>
                  <th className="text-right font-medium pb-1.5 pr-6">Total</th>
                  <th className="text-right font-medium pb-1.5 pr-6">{metricLabel}</th>
                  {!hideAbsences && <th className="text-right font-medium pb-1.5 pr-6">Inasist.</th>}
                  {!hideAbsences && <th className="text-right font-medium pb-1.5 pr-6">Cancel.</th>}
                  <th className="text-right font-medium pb-1.5">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const val     = metric(row)
                  const inasist = Math.max(0, row.total - row.asistieron - (row.cancelaron ?? 0))
                  const pct     = totalMetric > 0 ? ((val / totalMetric) * 100).toFixed(0) : '0'
                  return (
                    <tr key={row.plataforma} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 pr-6">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color(i) }} />
                          <span className="text-gray-700 font-medium">{row.plataforma}</span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-6 text-right text-gray-500">{row.total.toLocaleString()}</td>
                      <td className="py-1.5 pr-6 text-right font-bold" style={{ color: color(i) }}>{val.toLocaleString()}</td>
                      {!hideAbsences && <td className="py-1.5 pr-6 text-right font-medium text-orange-500">{inasist.toLocaleString()}</td>}
                      {!hideAbsences && <td className="py-1.5 pr-6 text-right text-gray-400">{(row.cancelaron ?? 0).toLocaleString()}</td>}
                      <td className="py-1.5 text-right font-semibold text-gray-600">{pct}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  )
}

// ── Platform stat cards ────────────────────────────────────────────────
function PlatCards({ rows, metricKey = 'asistieron' }: {
  rows: PlatRow[]; metricKey?: string
}) {
  if (!rows.length) return null
  const totalMetric = rows.reduce((s, r) => s + ((r as any)[metricKey] ?? 0), 0)
  return (
    <div className="mt-4 flex justify-end flex-wrap gap-2">
      {rows.map((row, i) => {
        const val = (row as any)[metricKey] ?? 0
        const pct = totalMetric > 0 ? ((val / totalMetric) * 100).toFixed(0) : '0'
        return (
          <div key={row.plataforma} className="rounded-lg px-3 py-2 text-center min-w-[86px]"
            style={{ backgroundColor: color(i) + '18' }}>
            <p className="text-base font-bold leading-tight" style={{ color: color(i) }}>
              {val.toLocaleString()}
            </p>
            <p className="text-xs text-gray-600 mt-0.5 truncate max-w-[100px]">{row.plataforma}</p>
            <p className="text-xs text-gray-400">{pct}%</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Section Card ───────────────────────────────────────────────────────
function SectionCard({ title, subtitle, section, metricKey = 'asistieron', metricLabel = 'Asist.',
  loading, isComplementaria = false }: {
  title: string; subtitle: string; section: Section
  metricKey?: string; metricLabel?: string; loading: boolean; isComplementaria?: boolean
}) {
  const totalComp = section.asistieron
  // Totales consolidados de la sección (usados a la derecha del header)
  const sectionTotal   = (section as any).total       ?? section.porPlataforma.reduce((a, r) => a + r.total, 0)
  const sectionMetric  = (section as any)[metricKey]  ?? section.porPlataforma.reduce((a, r) => a + ((r as any)[metricKey] ?? 0), 0)
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide">{title}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        {/* Totales de la sección — antes vivían en el panel izquierdo; ahora
            van inline al lado del título para que sea inmediato leer el resumen
            del bloque sin desviar la mirada al aside. */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Total</p>
            <p className="text-lg font-bold text-gray-900 leading-none">{sectionTotal.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{metricLabel}</p>
            <p className="text-lg font-bold text-blue-700 leading-none">{sectionMetric.toLocaleString()}</p>
          </div>
          {loading && <span className="text-xs text-gray-400 animate-pulse">Cargando...</span>}
        </div>
      </div>

      <PlatDonut rows={section.porPlataforma} metricKey={metricKey} metricLabel={metricLabel} hideAbsences={isComplementaria} />

      {isComplementaria ? (
        <div className="mt-4 flex justify-end">
          <div className="rounded-lg px-5 py-3 text-center" style={{ backgroundColor: '#10b981' + '18' }}>
            <p className="text-2xl font-bold" style={{ color: '#10b981' }}>{totalComp.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">Generadas</p>
          </div>
        </div>
      ) : (
        <PlatCards rows={section.porPlataforma} metricKey={metricKey} />
      )}
    </div>
  )
}

// ── Consolidación por país (Sesiones + Jumps + Training + Clubes) ─────
interface ConsolidatedRow { plataforma: string; total: number; asistieron: number }

function consolidatePorPais(sections: Section[]): ConsolidatedRow[] {
  const map = new Map<string, ConsolidatedRow>()
  for (const s of sections) {
    for (const row of s.porPlataforma) {
      const cur = map.get(row.plataforma) ?? { plataforma: row.plataforma, total: 0, asistieron: 0 }
      cur.total += row.total
      cur.asistieron += row.asistieron
      map.set(row.plataforma, cur)
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// ── Main Page ──────────────────────────────────────────────────────────
export default function InformeXPaisPage() {
  const [startDate, setStartDate] = useState(firstOfYear)
  const [endDate, setEndDate]     = useState(today)
  const [data, setData]           = useState<XPaisResponse | null>(null)
  const [loading, setLoading]     = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ startDate, endDate })
      const res = await fetch(`/api/postgres/reports/asistencia/x-pais?${qs}`)
      const json = await res.json()
      if (json.success) setData(json)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [startDate, endDate])

  useEffect(() => { fetchData() }, [fetchData])

  const ses  = data?.sesiones        ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }
  const jmp  = data?.jumps           ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }
  const tr   = data?.training        ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }
  const cl   = data?.clubes          ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }
  const wel  = data?.welcome         ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }
  const comp = data?.complementarias ?? { total: 0, asistieron: 0, cancelaron: 0, aprobaron: 0, noAprobaron: 0, porPlataforma: [] }

  const handleCSV = () => {
    type Row = {
      sec: string; pais: string; total: number | string
      metrica: number | string; metricaLabel: string
      inasist: number | string; cancel: number | string; pct: string
    }
    const rows: Row[] = [
      { sec: 'Filtros', pais: 'Fecha inicial', total: startDate, metrica: '', metricaLabel: '', inasist: '', cancel: '', pct: '' },
      { sec: 'Filtros', pais: 'Fecha final',   total: endDate,   metrica: '', metricaLabel: '', inasist: '', cancel: '', pct: '' },
    ]
    const addSection = (label: string, s: Section, mKey: string, mLabel: string) => {
      const totTotal    = s.porPlataforma.reduce((a, r) => a + r.total, 0)
      const totMetrica  = s.porPlataforma.reduce((a, r) => a + ((r as any)[mKey] ?? 0), 0)
      const totAsist    = s.porPlataforma.reduce((a, r) => a + r.asistieron, 0)
      const totCancel   = s.porPlataforma.reduce((a, r) => a + (r.cancelaron ?? 0), 0)
      const totInasist  = Math.max(0, totTotal - totAsist - totCancel)
      rows.push({
        sec: label, pais: 'TOTAL', total: totTotal, metrica: totMetrica, metricaLabel: mLabel,
        inasist: totInasist, cancel: totCancel, pct: '100%',
      })
      s.porPlataforma.forEach(r => {
        const val     = (r as any)[mKey] ?? 0
        const inasist = Math.max(0, r.total - r.asistieron - (r.cancelaron ?? 0))
        rows.push({
          sec: label, pais: r.plataforma, total: r.total,
          metrica: val, metricaLabel: mLabel,
          inasist, cancel: r.cancelaron ?? 0,
          pct: totMetrica > 0 ? `${((val / totMetrica) * 100).toFixed(1)}%` : '0%',
        })
      })
    }
    addSection('SESIONES',        ses,  'asistieron', 'Asistieron')
    addSection('JUMPS',           jmp,  'aprobaron',  'Aprobaron')
    addSection('TRAINING',        tr,   'asistieron', 'Asistieron')
    addSection('CLUBES',          cl,   'asistieron', 'Asistieron')
    addSection('WELCOME',         wel,  'asistieron', 'Asistieron')
    addSection('COMPLEMENTARIAS', comp, 'asistieron', 'Generadas')
    exportToExcel(rows, [
      { header: 'Sección',        accessor: r => r.sec           },
      { header: 'País',           accessor: r => r.pais          },
      { header: 'Total',          accessor: r => r.total         },
      { header: 'Métrica',        accessor: r => r.metrica       },
      { header: 'Inasistencias',  accessor: r => r.inasist       },
      { header: 'Canceladas',     accessor: r => r.cancel        },
      { header: '% Asistencia',   accessor: r => r.pct           },
    ], `asistencia-x-pais_${startDate}_${endDate}`)
  }

  return (
    <DashboardLayout>
      <div className="flex gap-5 min-h-screen">

        {/* ── Left Panel ──
            Antes mostraba el total de cada sección individualmente. Ahora
            esos números se moved al header de cada SectionCard. El panel
            izquierdo se reutiliza para dos cuadros consolidados por país:
            (1) Sesiones+Jumps+Training+Clubes — total y asistieron combinados
            (2) Complementarias — total, generadas y % por país             */}
        <aside className="w-72 flex-shrink-0">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sticky top-4">
            <h2 className="text-base font-bold text-gray-900 mb-1">Consolidado por País</h2>
            <p className="text-xs text-gray-400 mb-3">{startDate} → {endDate}</p>

            {/* Eventos Asistencia — participación (%) de cada país sobre el total
                de asistencias a TODOS los eventos (excluye complementarias).
                Incluye Sesiones + Jumps + Training + Clubes + Welcome.        */}
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Eventos Asistencia
            </p>
            {(() => {
              const rows = [...consolidatePorPais([ses, jmp, tr, cl, wel])]
                .sort((a, b) => b.asistieron - a.asistieron)
              const asisTotal = rows.reduce((a, r) => a + r.asistieron, 0)
              return (
                <table className="w-full text-xs mb-4">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left font-medium pb-1 pr-1">País</th>
                      <th className="text-right font-medium pb-1 pr-1">Asistencia</th>
                      <th className="text-right font-medium pb-1">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={3} className="text-gray-400 italic py-2">Sin datos</td></tr>
                    ) : rows.map((r, i) => {
                      // % = participación del país sobre el total de asistencias
                      // (su porción del 100% de asistentes a todos los eventos)
                      const pct = asisTotal > 0 ? ((r.asistieron / asisTotal) * 100).toFixed(0) : '0'
                      return (
                        <tr key={r.plataforma} className="border-b border-gray-50 last:border-0">
                          <td className="py-1 pr-1 text-gray-700 truncate max-w-[70px]" title={r.plataforma}>
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: color(i) }} />
                            {r.plataforma}
                          </td>
                          <td className="py-1 pr-1 text-right text-blue-700 font-medium">{r.asistieron.toLocaleString()}</td>
                          <td className="py-1 text-right text-gray-500">{pct}%</td>
                        </tr>
                      )
                    })}
                    {rows.length > 0 && (
                      <tr className="border-t-2 border-gray-300 font-bold">
                        <td className="pt-1.5 pr-1 text-gray-800">TOTAL</td>
                        <td className="pt-1.5 pr-1 text-right text-blue-800">{asisTotal.toLocaleString()}</td>
                        <td className="pt-1.5 text-right text-gray-600">100%</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )
            })()}

            {/* Asistencia vs Agendamiento — tasa de asistencia (asistencia/agendamiento) por país */}
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3 pt-3 border-t border-gray-200">
              Asistencia vs Agendamiento
            </p>
            {(() => {
              const rows = consolidatePorPais([ses, jmp, tr, cl])
              const totGeneral = rows.reduce((a, r) => a + r.total, 0)
              const asisGeneral = rows.reduce((a, r) => a + r.asistieron, 0)
              return (
                <table className="w-full text-xs mb-4">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left font-medium pb-1 pr-2">País</th>
                      <th className="text-right font-medium pb-1 pr-3">Agend.</th>
                      <th className="text-right font-medium pb-1 pr-3">Asist.</th>
                      <th className="text-right font-medium pb-1 pl-1">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={4} className="text-gray-400 italic py-2">Sin datos</td></tr>
                    ) : rows.map((r, i) => {
                      // % = tasa de asistencia (asistidas / total agendadas) por país
                      const pct = r.total > 0 ? ((r.asistieron / r.total) * 100).toFixed(0) : '0'
                      return (
                        <tr key={r.plataforma} className="border-b border-gray-50 last:border-0">
                          <td className="py-1 pr-2 text-gray-700 truncate max-w-[80px]" title={r.plataforma}>
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: color(i) }} />
                            {r.plataforma}
                          </td>
                          <td className="py-1 pr-3 text-right font-semibold text-gray-900">{r.total.toLocaleString()}</td>
                          <td className="py-1 pr-3 text-right text-blue-700 font-medium">{r.asistieron.toLocaleString()}</td>
                          <td className="py-1 pl-1 text-right text-gray-500">{pct}%</td>
                        </tr>
                      )
                    })}
                    {rows.length > 0 && (
                      <tr className="border-t-2 border-gray-300 font-bold">
                        <td className="pt-1.5 pr-2 text-gray-800">TOTAL</td>
                        <td className="pt-1.5 pr-3 text-right text-gray-900">{totGeneral.toLocaleString()}</td>
                        <td className="pt-1.5 pr-3 text-right text-blue-800">{asisGeneral.toLocaleString()}</td>
                        <td className="pt-1.5 pl-1 text-right text-gray-600">
                          {totGeneral > 0 ? `${((asisGeneral / totGeneral) * 100).toFixed(0)}%` : '0%'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )
            })()}

            {/* Complementarias por país — Total / Generadas / % */}
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-3 pt-3 border-t border-gray-200">
              Complementarias
            </p>
            {(() => {
              const generGral = comp.porPlataforma.reduce((a, r) => a + r.asistieron, 0)
              return (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="text-left font-medium pb-1 pr-1">País</th>
                      <th className="text-right font-medium pb-1 pr-1">Generadas</th>
                      <th className="text-right font-medium pb-1">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comp.porPlataforma.length === 0 ? (
                      <tr><td colSpan={3} className="text-gray-400 italic py-2">Sin datos</td></tr>
                    ) : comp.porPlataforma.map((r, i) => {
                      // % = participación de las generadas de este país sobre el
                      // total general de complementarias generadas
                      const pct = generGral > 0 ? ((r.asistieron / generGral) * 100).toFixed(0) : '0'
                      return (
                        <tr key={r.plataforma} className="border-b border-gray-50 last:border-0">
                          <td className="py-1 pr-1 text-gray-700 truncate max-w-[70px]" title={r.plataforma}>
                            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: color(i) }} />
                            {r.plataforma}
                          </td>
                          <td className="py-1 pr-1 text-right text-emerald-700 font-medium">{r.asistieron.toLocaleString()}</td>
                          <td className="py-1 text-right text-gray-500">{pct}%</td>
                        </tr>
                      )
                    })}
                    {comp.porPlataforma.length > 0 && (
                      <tr className="border-t-2 border-gray-300 font-bold">
                        <td className="pt-1.5 pr-1 text-gray-800">TOTAL</td>
                        <td className="pt-1.5 pr-1 text-right text-emerald-800">{generGral.toLocaleString()}</td>
                        <td className="pt-1.5 text-right text-gray-600">
                          {generGral > 0 ? '100%' : '0%'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )
            })()}
          </div>
        </aside>

        {/* ── Main Content ── */}
        <div className="flex-1 space-y-5">

          {/* ── Filter Bar ── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="xp-start" className="block text-xs text-gray-500 mb-1">Fecha inicial</label>
                <input id="xp-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label htmlFor="xp-end" className="block text-xs text-gray-500 mb-1">Fecha final</label>
                <input id="xp-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={() => { setStartDate(firstOfYear); setEndDate(today) }}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                  Limpiar filtros
                </button>
                <PermissionGuard permission={InformesPermission.ASIS_XPAIS_EXP}>
                  <button type="button" onClick={handleCSV} disabled={loading}
                    className="px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Descargar CSV
                  </button>
                </PermissionGuard>
              </div>
            </div>
          </div>

          <SectionCard title="Sesiones"
            subtitle="SESSION — Step 0–45 excluyendo múltiplos de 5"
            section={ses} metricKey="asistieron" metricLabel="Asist."
            loading={loading} />

          <SectionCard title="Jumps"
            subtitle="SESSION — Steps múltiplos de 5 (5, 10, 15 … 45)"
            section={jmp} metricKey="aprobaron" metricLabel="Aprob."
            loading={loading} />

          <SectionCard title="Training"
            subtitle="CLUB — TRAINING – Step X"
            section={tr} metricKey="asistieron" metricLabel="Asist."
            loading={loading} />

          <SectionCard title="Clubes"
            subtitle="CLUB — GRAMMAR / LISTENING / KARAOKE / PRONUNCIATION / CONVERSATION"
            section={cl} metricKey="asistieron" metricLabel="Asist."
            loading={loading} />

          <SectionCard title="Welcome"
            subtitle="Nivel WELCOME — sesiones de bienvenida"
            section={wel} metricKey="asistieron" metricLabel="Asist."
            loading={loading} />

          <SectionCard title="Complementarias"
            subtitle="Actividades complementarias — tipo COMPLEMENTARIA"
            section={comp} metricKey="asistieron" metricLabel="Generadas"
            loading={loading} isComplementaria />

        </div>
      </div>
    </DashboardLayout>
  )
}
