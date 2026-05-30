'use client'

import { useState } from 'react'
import { ArrowDownTrayIcon, ArrowPathIcon, StarIcon } from '@heroicons/react/24/solid'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission, Role } from '@/types/permissions'
import { usePerformanceDashboard } from '@/hooks/use-evaluations'
import { useSession } from 'next-auth/react'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const oneMonthBackStr = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PerformanceEvaluationPage() {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role
  const canSeeRawComments = role === Role.SUPER_ADMIN || role === Role.ADMIN

  const [filters, setFilters] = useState({
    startDate: oneMonthBackStr(),
    endDate:   todayStr(),
    advisorId: '',
    nivel:     '',
    tipo:      '',
    plataforma: '',
  })

  const dashQ = usePerformanceDashboard({
    startDate: filters.startDate || null,
    endDate:   filters.endDate || null,
    advisorId: filters.advisorId || null,
    nivel:     filters.nivel || null,
    tipo:      filters.tipo || null,
    plataforma: filters.plataforma || null,
  })

  const data: any = dashQ.data
  const kpis  = data?.kpis ?? null
  const top5  = data?.rankingTop5 ?? []
  const bot5  = data?.rankingBottom5 ?? []
  const full  = data?.rankingFull ?? []
  const distr = data?.distribucion ?? []
  const evo   = data?.evolucionMensual ?? []
  const com   = data?.comentarios ?? []

  const handleCSV = () => {
    if (!full.length) return
    exportToExcel(full, [
      { header: 'Advisor',      accessor: (r: any) => r.nombre },
      { header: '# Evals',      accessor: (r: any) => r.evaluaciones },
      { header: 'Promedio',     accessor: (r: any) => r.promedio },
      { header: 'Puntualidad',  accessor: (r: any) => r.dimensiones.puntualidad },
      { header: 'Claridad',     accessor: (r: any) => r.dimensiones.claridad },
      { header: 'Actividades',  accessor: (r: any) => r.dimensiones.actividades },
      { header: 'Ambiente',     accessor: (r: any) => r.dimensiones.ambiente },
      { header: 'Motivación',   accessor: (r: any) => r.dimensiones.motivacion },
      { header: 'Satisfacción', accessor: (r: any) => r.dimensiones.satisfaccionGeneral },
    ], `performance-evaluation_${filters.startDate}_${filters.endDate}`)
  }

  const distrMax = Math.max(1, ...distr.map((d: any) => d.total))
  const evoMax   = Math.max(1, ...evo.map((e: any) => e.evaluaciones))

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.PERFORMANCE_EVAL_VER}>
        <div className="space-y-5 pb-10">
          {/* Header + filtros */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <StarIcon className="h-7 w-7 text-amber-500" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Performance Evaluation</h1>
                <p className="text-sm text-gray-500">Evaluaciones de estudiantes a advisors. Ranking Top 5 / Bottom 5 (mín 5 evals).</p>
              </div>
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label htmlFor="pe-start" className="block text-xs text-gray-500 mb-1">Desde</label>
                <input id="pe-start" type="date" value={filters.startDate}
                  onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="pe-end" className="block text-xs text-gray-500 mb-1">Hasta</label>
                <input id="pe-end" type="date" value={filters.endDate}
                  onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="pe-tipo" className="block text-xs text-gray-500 mb-1">Tipo</label>
                <select id="pe-tipo" value={filters.tipo}
                  onChange={e => setFilters(f => ({ ...f, tipo: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Todos</option>
                  <option value="SESSION">Session</option>
                  <option value="CLUB">Club</option>
                </select>
              </div>
              <button type="button" onClick={() => dashQ.refetch()}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">
                <ArrowPathIcon className="h-4 w-4" />Recargar
              </button>
              <PermissionGuard permission={AcademicoPermission.PERFORMANCE_EVAL_EXPORTAR}>
                <button type="button" onClick={handleCSV} disabled={dashQ.isLoading || !full.length}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                  <ArrowDownTrayIcon className="h-4 w-4" />CSV
                </button>
              </PermissionGuard>
            </div>
          </div>

          {dashQ.isError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {(dashQ.error as any)?.message || 'Error al cargar'}
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total Evaluaciones" value={kpis?.totalEvaluaciones?.toLocaleString() ?? '—'} />
            <Kpi label="Promedio General"  value={kpis?.promedioGeneral != null ? `${kpis.promedioGeneral} ★` : '—'} />
            <Kpi label="Satisfacción ≥4★"  value={kpis?.satisfaccionPct != null ? `${kpis.satisfaccionPct}%` : '—'} />
            <Kpi label="Más evaluado"      value={kpis?.advisorConMasEvals?.nombre || '—'} sub={kpis?.advisorConMasEvals ? `${kpis.advisorConMasEvals.evaluaciones} evals` : ''} />
          </div>

          {/* Top 5 / Bottom 5 */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <RankingCard title="🏆 Top 5 mejor calificados" subtitle="mín. 5 evaluaciones" rows={top5} color="emerald" />
            <RankingCard title="⚠ Bottom 5 peor calificados" subtitle="mín. 5 evaluaciones" rows={bot5} color="red" />
          </div>

          {/* Distribución + Evolución */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Distribución de calificaciones</h3>
              {distr.length === 0 ? <p className="text-sm text-gray-400">Sin datos</p> : (
                <div className="space-y-2">
                  {distr.map((d: any) => (
                    <div key={d.estrella} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-12">{d.estrella} ★</span>
                      <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
                        <div className="h-full bg-amber-400" style={{ width: `${(d.total / distrMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-700 w-10 text-right">{d.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Evolución mensual</h3>
              {evo.length === 0 ? <p className="text-sm text-gray-400">Sin datos</p> : (
                <div className="space-y-2">
                  {evo.map((e: any) => (
                    <div key={e.mes} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-16">{e.mes}</span>
                      <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${(e.evaluaciones / evoMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-700 w-20 text-right">{e.promedio} ★ · {e.evaluaciones}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Comentarios */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-gray-800">Comentarios recientes</h3>
              <p className="text-[11px] text-gray-400">
                {com.length} {com.length === 1 ? 'comentario' : 'comentarios'}
                {!canSeeRawComments && <span> · anónimos para roles no-admin</span>}
              </p>
            </div>
            {com.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin comentarios en el período</p> : (
              <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {com.map((c: any) => (
                  <li key={c._id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
                      <span className="font-semibold text-gray-700">{c.advisorNombre || '—'}</span>
                      <span>· {c.tipo}{c.subtipo ? ` (${c.subtipo})` : ''} · {c.nivel}</span>
                      <span>· {c.fechaEvento ? new Date(c.fechaEvento).toLocaleDateString('es-ES') : ''}</span>
                      <span className="ml-auto inline-flex items-center gap-0.5 text-amber-600 font-bold">{c.promedio}★</span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.comentario}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="text-2xl font-bold text-gray-900 truncate" title={value}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
    </div>
  )
}

function RankingCard({ title, subtitle, rows, color }: { title: string; subtitle: string; rows: any[]; color: 'emerald' | 'red' }) {
  const dotColor = color === 'emerald' ? 'bg-emerald-500' : 'bg-red-500'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-[11px] text-gray-400">{subtitle}</p>
      </div>
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin datos suficientes</p> : (
        <ol className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <li key={r.advisorId} className="px-5 py-2.5 flex items-center gap-3">
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs text-white font-bold ${dotColor}`}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{r.nombre}</p>
                <p className="text-[11px] text-gray-500">{r.evaluaciones} evaluaciones</p>
              </div>
              <span className="text-lg font-bold text-amber-500">{r.promedio}★</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
