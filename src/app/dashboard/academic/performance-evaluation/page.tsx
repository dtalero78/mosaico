'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownTrayIcon, ArrowPathIcon, StarIcon, UserGroupIcon, UserCircleIcon } from '@heroicons/react/24/solid'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { exportToExcel } from '@/lib/export-excel'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { AcademicoPermission, Role } from '@/types/permissions'
import { usePerformanceDashboard, useAdvisorsWithEvaluations } from '@/hooks/use-evaluations'
import { usePermissions } from '@/hooks/usePermissions'
import { useSession } from 'next-auth/react'

/** Dimensiones V2 con sus labels canónicos (mismo orden que el modal). */
const DIM_LABELS: Record<string, string> = {
  puntualidad: 'Puntualidad y organización',
  claridad:    'Claridad de la explicación',
  actividades: 'Participación y actividades',
  ambiente:    'Ambiente de aprendizaje',
}
const DIM_KEYS = ['puntualidad', 'claridad', 'actividades', 'ambiente'] as const

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const oneMonthBackStr = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Chips sugeridos sobre comentarios — clic filtra el buscador. */
const COMMENT_KEYWORDS = ['tarde', 'rápido', 'no entendí', 'excelente', 'aburrido', 'práctica', 'audio']

export default function PerformanceEvaluationPage() {
  const { data: session } = useSession()
  const role = (session?.user as any)?.role
  const canSeeRawComments = role === Role.SUPER_ADMIN || role === Role.ADMIN
  const { hasPermission } = usePermissions()
  const canSeeByAdvisor = hasPermission(AcademicoPermission.PERFORMANCE_EVAL_POR_ADVISOR)
                        || role === Role.SUPER_ADMIN || role === Role.ADMIN

  // Tab activo: vista general o vista por advisor.
  const [view, setView] = useState<'general' | 'porAdvisor'>('general')

  const [filters, setFilters] = useState({
    startDate: oneMonthBackStr(),
    endDate:   todayStr(),
    advisorId: '',
    nivel:     '',
    tipo:      '',
    plataforma: '',
    comentarioSearch: '',
  })

  // Modal de radar por advisor (cuando se hace click en una fila del ranking).
  const [radarAdvisor, setRadarAdvisor] = useState<any | null>(null)

  const dashQ = usePerformanceDashboard({
    startDate: filters.startDate || null,
    endDate:   filters.endDate || null,
    advisorId: filters.advisorId || null,
    nivel:     filters.nivel || null,
    tipo:      filters.tipo || null,
    plataforma: filters.plataforma || null,
    comentarioSearch: filters.comentarioSearch || null,
  })

  const data: any = dashQ.data
  const kpis  = data?.kpis ?? null
  const top5  = data?.rankingTop5 ?? []
  const bot5  = data?.rankingBottom5 ?? []
  const full  = data?.rankingFull ?? []
  const distr = data?.distribucion ?? []
  const evo   = data?.evolucionMensual ?? []
  const com   = data?.comentarios ?? []
  const porDim = data?.porDimension ?? []

  const handleCSV = () => {
    if (!full.length) return
    exportToExcel(full, [
      { header: 'Advisor',      accessor: (r: any) => r.nombre },
      { header: '# Evals',      accessor: (r: any) => r.evaluaciones },
      { header: 'Promedio',     accessor: (r: any) => r.promedio },
      { header: 'Puntualidad',  accessor: (r: any) => r.dimensiones?.puntualidad ?? '' },
      { header: 'Claridad',     accessor: (r: any) => r.dimensiones?.claridad ?? '' },
      { header: 'Actividades',  accessor: (r: any) => r.dimensiones?.actividades ?? '' },
      { header: 'Ambiente',     accessor: (r: any) => r.dimensiones?.ambiente ?? '' },
    ], `performance-evaluation_${filters.startDate}_${filters.endDate}`)
  }

  const handleCSVComentarios = () => {
    if (!com.length) return
    exportToExcel(com, [
      { header: 'Fecha',        accessor: (c: any) => c.fechaEvento ? new Date(c.fechaEvento).toLocaleDateString('es-ES') : '' },
      { header: 'Advisor',      accessor: (c: any) => canSeeRawComments ? (c.advisorNombre || '') : 'anónimo' },
      { header: 'Tipo',         accessor: (c: any) => c.tipo + (c.subtipo ? ` (${c.subtipo})` : '') },
      { header: 'Nivel',        accessor: (c: any) => c.nivel || '' },
      { header: 'Promedio',     accessor: (c: any) => c.promedio },
      { header: 'Comentario',   accessor: (c: any) => c.comentario || '' },
      { header: 'IA Sentimiento', accessor: (c: any) => c.aiSentimiento || '' },
    ], `performance-eval-comentarios_${filters.startDate}_${filters.endDate}`)
  }

  const distrMax = Math.max(1, ...distr.map((d: any) => d.total))
  const evoMax   = Math.max(1, ...evo.map((e: any) => e.evaluaciones))

  return (
    <DashboardLayout>
      <PermissionGuard permission={AcademicoPermission.PERFORMANCE_EVAL_VER}>
        <div className="space-y-5 pb-10">
          {/* Header con tabs */}
          <div className="flex items-center gap-3">
            <StarIcon className="h-7 w-7 text-amber-500" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Performance Evaluation</h1>
              <p className="text-sm text-gray-500">
                {view === 'general'
                  ? 'Vista global de evaluaciones — Top 5 / 5 Promedios Más Bajos.'
                  : 'Vista por advisor — métricas individuales comparadas contra el promedio general.'}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setView('general')}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                view === 'general'
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              <UserGroupIcon className="h-4 w-4" /> Vista General
            </button>
            {canSeeByAdvisor && (
              <button
                type="button"
                onClick={() => setView('porAdvisor')}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                  view === 'porAdvisor'
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                <UserCircleIcon className="h-4 w-4" /> Por Advisor
              </button>
            )}
          </div>

          {/* ─────────────────────────────────────────────────────────────
              VISTA POR ADVISOR — comparativos contra promedio general
            ───────────────────────────────────────────────────────────── */}
          {view === 'porAdvisor' && (
            <PermissionGuard permission={AcademicoPermission.PERFORMANCE_EVAL_POR_ADVISOR}>
              <ByAdvisorView
                filterDates={{ startDate: filters.startDate, endDate: filters.endDate, tipo: filters.tipo }}
                onFilterDatesChange={(patch) => setFilters(f => ({ ...f, ...patch }))}
                canExport={true}
              />
            </PermissionGuard>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VISTA GENERAL (la original — sin cambios funcionales)
            ───────────────────────────────────────────────────────────── */}
          {view === 'general' && (<>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex-1" />
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Total Evaluaciones" value={kpis?.totalEvaluaciones?.toLocaleString() ?? '—'} />
            <Kpi label="Promedio General"  value={kpis?.promedioGeneral != null ? `${kpis.promedioGeneral} ★` : '—'} />
            <Kpi label="Satisfacción ≥4★"  value={kpis?.satisfaccionPct != null ? `${kpis.satisfaccionPct}%` : '—'} />
            <Kpi label="Más evaluado"      value={kpis?.advisorConMasEvals?.nombre || '—'} sub={kpis?.advisorConMasEvals ? `${kpis.advisorConMasEvals.evaluaciones} evals` : ''} />
            <Kpi label="% con comentario"  value={kpis?.pctConComentario != null ? `${kpis.pctConComentario}%` : '—'} sub={kpis ? `${kpis.totalComentarios} comentarios` : ''} />
            <Kpi label="Largo prom. coment." value={kpis?.largoPromedioComentario != null ? `${kpis.largoPromedioComentario} car.` : '—'} />
          </div>

          {/* Métricas por dimensión (4 dims) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Métricas por dimensión</h3>
              <p className="text-[11px] text-gray-400">Cómo se distribuye cada uno de los 4 ítems evaluados</p>
            </div>
            <div className="p-4">
              {porDim.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Sin datos</p> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium py-2">Dimensión</th>
                      <th className="text-right font-medium py-2 w-20">Promedio</th>
                      <th className="text-right font-medium py-2 w-20">≥4★</th>
                      <th className="text-left font-medium py-2 pl-4">Distribución 1→5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porDim.map((d: any) => {
                      const max = Math.max(1, ...d.distribucion.map((x: any) => x.total))
                      return (
                        <tr key={d.dim} className="border-b border-gray-50 last:border-0">
                          <td className="py-3 font-medium text-gray-800">{DIM_LABELS[d.dim] || d.dim}</td>
                          <td className="py-3 text-right text-amber-600 font-bold">{d.promedio} ★</td>
                          <td className="py-3 text-right text-gray-700">{d.satisfaccionPct}%</td>
                          <td className="py-3 pl-4">
                            <div className="flex items-end gap-1 h-12">
                              {d.distribucion.map((x: any) => {
                                const pct = (x.total / max) * 100
                                const color = x.estrella >= 4 ? 'bg-emerald-400' : x.estrella === 3 ? 'bg-amber-400' : 'bg-red-400'
                                return (
                                  <div key={x.estrella} className="flex-1 flex flex-col items-center justify-end" title={`${x.estrella}★: ${x.total}`}>
                                    <div className={`w-full ${color} rounded-t`} style={{ height: `${pct}%`, minHeight: x.total > 0 ? 2 : 0 }} />
                                    <span className="text-[10px] text-gray-500 mt-0.5">{x.estrella}★</span>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Top 5 / 5 Promedios más bajos — fila clickeable abre radar del advisor.
              El "más bajos" filtra a promedio < 4 — si no hay, mensaje verde
              de buenas noticias en vez de "Sin datos suficientes". */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <RankingCard
              title="🏆 Top 5 Mejor Promedio"
              subtitle="mín. 5 evaluaciones · clic para ver desglose"
              rows={top5}
              color="emerald"
              onClickRow={setRadarAdvisor}
            />
            <RankingCard
              title="⚠ 5 Promedios Más Bajos"
              subtitle="advisors con promedio < 4 ★ · clic para ver desglose"
              rows={bot5.filter((r: any) => Number(r.promedio) < 4)}
              color="red"
              onClickRow={setRadarAdvisor}
              emptyMessage="No hay advisors con promedios por debajo de 4 ★"
            />
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

          {/* Comentarios — buscador + chips + lista */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-gray-800">Comentarios recientes</h3>
              <p className="text-[11px] text-gray-400">
                {com.length} {com.length === 1 ? 'comentario' : 'comentarios'}
                {!canSeeRawComments && <span> · anónimos para roles no-admin</span>}
              </p>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2 flex-wrap">
              <label htmlFor="pe-coment-search" className="sr-only">Buscar en comentarios</label>
              <input
                id="pe-coment-search"
                type="text"
                value={filters.comentarioSearch}
                onChange={e => setFilters(f => ({ ...f, comentarioSearch: e.target.value }))}
                placeholder="Buscar palabra clave en comentarios…"
                className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
              />
              {COMMENT_KEYWORDS.map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, comentarioSearch: f.comentarioSearch === k ? '' : k }))}
                  className={`px-2.5 py-1 text-xs rounded-full border ${
                    filters.comentarioSearch === k
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >{k}</button>
              ))}
              <PermissionGuard permission={AcademicoPermission.PERFORMANCE_EVAL_EXPORTAR}>
                <button type="button" onClick={handleCSVComentarios} disabled={!com.length}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />CSV
                </button>
              </PermissionGuard>
            </div>
            {com.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin comentarios en el período</p> : (
              <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {com.map((c: any) => (
                  <li key={c._id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
                      <span className="font-semibold text-gray-700">{c.advisorNombre || '—'}</span>
                      <span>· {c.tipo}{c.subtipo ? ` (${c.subtipo})` : ''} · {c.nivel}</span>
                      <span>· {c.fechaEvento ? new Date(c.fechaEvento).toLocaleDateString('es-ES') : ''}</span>
                      {c.aiSentimiento && (
                        <span className={`px-1.5 rounded-full text-[10px] font-medium ${
                          c.aiSentimiento === 'positivo' ? 'bg-emerald-100 text-emerald-700'
                            : c.aiSentimiento === 'negativo' ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>{c.aiSentimiento}</span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-0.5 text-amber-600 font-bold">{c.promedio}★</span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.comentario}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>)}
          {/* fin view === 'general' */}
        </div>

        {/* Modal radar advisor */}
        {radarAdvisor && (
          <RadarAdvisorModal advisor={radarAdvisor} onClose={() => setRadarAdvisor(null)} />
        )}
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

function RankingCard({
  title, subtitle, rows, color, onClickRow, emptyMessage,
}: {
  title: string; subtitle: string; rows: any[]; color: 'emerald' | 'red';
  onClickRow?: (advisor: any) => void;
  emptyMessage?: string;
}) {
  const dotColor = color === 'emerald' ? 'bg-emerald-500' : 'bg-red-500'
  // Estilo del empty state: si la card es "red" y el mensaje es custom (caso
  // 5 Promedios Más Bajos sin advisors bajo 4★) lo presentamos en verde como
  // "buena noticia". Si no, gris neutro estándar.
  const isGoodNews = color === 'red' && !!emptyMessage
  const emptyText = emptyMessage || 'Sin datos suficientes'
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <p className="text-[11px] text-gray-400">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className={`p-6 text-center text-sm ${isGoodNews ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>
          {isGoodNews ? '🎉 ' : ''}{emptyText}
        </p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <li key={r.advisorId}>
              <button
                type="button"
                onClick={() => onClickRow?.(r)}
                className="w-full px-5 py-2.5 flex items-center gap-3 hover:bg-gray-50 text-left"
              >
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs text-white font-bold ${dotColor}`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.nombre}</p>
                  <p className="text-[11px] text-gray-500">{r.evaluaciones} evaluaciones</p>
                </div>
                <span className="text-lg font-bold text-amber-500">{r.promedio}★</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Radar SVG de 4 ejes — muestra el promedio del advisor en cada dimensión
 * comparado con un círculo de referencia (escala 0-5). Sin dependencias.
 */
function RadarAdvisorModal({ advisor, onClose }: { advisor: any; onClose: () => void }) {
  const size = 260
  const center = size / 2
  const radius = size / 2 - 30

  const values = useMemo(() => DIM_KEYS.map(k => Number(advisor.dimensiones?.[k] || 0)), [advisor])

  // Coordenadas para cada vértice del polígono
  const points = useMemo(() => {
    return values.map((v, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 4
      const r = (v / 5) * radius
      return [center + r * Math.cos(angle), center + r * Math.sin(angle)]
    })
  }, [values, center, radius])

  const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z'

  // Etiquetas de los ejes
  const axes = DIM_KEYS.map((k, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 4
    return {
      x1: center, y1: center,
      x2: center + radius * Math.cos(angle), y2: center + radius * Math.sin(angle),
      labelX: center + (radius + 18) * Math.cos(angle),
      labelY: center + (radius + 18) * Math.sin(angle),
      label: DIM_LABELS[k] || k,
      value: values[i],
    }
  })

  // Círculos de referencia (1-5)
  const refs = [1, 2, 3, 4, 5].map(v => v * (radius / 5))

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-gray-900/70" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">{advisor.nombre}</h3>
              <p className="text-xs text-gray-500">{advisor.evaluaciones} evaluaciones · Promedio <span className="text-amber-600 font-bold">{advisor.promedio}★</span></p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none" title="Cerrar">&times;</button>
          </div>

          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto" aria-label="Radar de dimensiones">
            {/* Círculos de referencia */}
            {refs.map((r, i) => (
              <circle key={i} cx={center} cy={center} r={r} fill="none" stroke="#e5e7eb" strokeWidth={1} strokeDasharray={i === 4 ? undefined : '2,2'} />
            ))}
            {/* Ejes */}
            {axes.map((a, i) => (
              <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="#cbd5e1" strokeWidth={1} />
            ))}
            {/* Polígono advisor */}
            <path d={pathD} fill="rgb(99 102 241 / 0.35)" stroke="rgb(99 102 241)" strokeWidth={2} />
            {/* Puntos */}
            {points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={4} fill="rgb(99 102 241)" />
            ))}
            {/* Labels */}
            {axes.map((a, i) => (
              <text key={i} x={a.labelX} y={a.labelY} textAnchor="middle" dominantBaseline="middle"
                className="text-[10px] fill-gray-700 font-medium" style={{ fontSize: 10 }}>
                {a.label.split(' ')[0]}
              </text>
            ))}
          </svg>

          {/* Tabla de valores por dim */}
          <table className="w-full text-sm mt-4">
            <tbody>
              {DIM_KEYS.map(k => (
                <tr key={k} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-gray-700">{DIM_LABELS[k]}</td>
                  <td className="py-2 text-right text-amber-600 font-bold">{Number(advisor.dimensiones?.[k] || 0).toFixed(2)} ★</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   VISTA "POR ADVISOR"
   Dropdown de advisor con toggle Activos/Inactivos/Todos (default Activos).
   Métricas del advisor seleccionado comparadas contra el promedio general
   (mismas fechas + mismo tipo de evento), con deltas visuales.
   ═══════════════════════════════════════════════════════════════════════ */
function ByAdvisorView({
  filterDates, onFilterDatesChange, canExport,
}: {
  filterDates: { startDate: string; endDate: string; tipo: string };
  onFilterDatesChange: (patch: Partial<{ startDate: string; endDate: string; tipo: string }>) => void;
  canExport: boolean;
}) {
  const [advisorFilter, setAdvisorFilter] = useState<'activos' | 'inactivos' | 'todos'>('activos')
  const [advisorId, setAdvisorId] = useState<string>('')

  const advisorsQ = useAdvisorsWithEvaluations()
  const advisorsRaw: any[] = advisorsQ.data?.advisors ?? []

  const advisorsList = useMemo(() => {
    if (advisorFilter === 'activos')   return advisorsRaw.filter(a => a.activo === true)
    if (advisorFilter === 'inactivos') return advisorsRaw.filter(a => a.activo !== true)
    return advisorsRaw
  }, [advisorsRaw, advisorFilter])

  // Si el advisor seleccionado se sale del set por cambio de filtro, lo limpio.
  useEffect(() => {
    if (advisorId && !advisorsList.some(a => a._id === advisorId)) {
      setAdvisorId('')
    }
  }, [advisorId, advisorsList])

  // Stats del advisor + stats del promedio general (sin filtro de advisor)
  // mismas fechas + mismo tipo para que la comparación sea justa.
  const baseFilters = {
    startDate: filterDates.startDate || null,
    endDate:   filterDates.endDate || null,
    tipo:      filterDates.tipo || null,
    nivel: null, plataforma: null, comentarioSearch: null,
  }
  const advisorStatsQ = usePerformanceDashboard({ ...baseFilters, advisorId: advisorId || null })
  const generalStatsQ = usePerformanceDashboard({ ...baseFilters, advisorId: null })

  const advData: any = advisorStatsQ.data
  const genData: any = generalStatsQ.data

  const advKpi = advData?.kpis ?? null
  const genKpi = genData?.kpis ?? null
  const advPorDim = advData?.porDimension ?? []
  const genPorDim = genData?.porDimension ?? []
  const advDistr  = advData?.distribucion ?? []
  const advEvo    = advData?.evolucionMensual ?? []
  const advCom    = advData?.comentarios ?? []
  const fullGen   = genData?.rankingFull ?? []

  // Posición en ranking general (1-based) entre advisors con ≥5 evals.
  const posicion = useMemo(() => {
    if (!advisorId || !fullGen.length) return null
    const idx = fullGen.findIndex((r: any) => r.advisorId === advisorId)
    if (idx < 0) return null
    return { posicion: idx + 1, total: fullGen.length }
  }, [advisorId, fullGen])

  const distrMax = Math.max(1, ...advDistr.map((d: any) => d.total))
  const evoMax   = Math.max(1, ...advEvo.map((e: any) => e.evaluaciones))

  // Genera badge de delta: ▲ +0.04 (verde) o ▼ −0.03 (rojo) o = (gris).
  const renderDelta = (advVal: number | null, genVal: number | null, suffix = '') => {
    if (advVal == null || genVal == null) return null
    const diff = advVal - genVal
    const sign = diff > 0 ? '▲' : diff < 0 ? '▼' : '='
    const color = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'
    const txt   = diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`
    return <span className={`text-[11px] font-medium ${color}`}>{sign} {txt}{suffix}</span>
  }

  const handleCSV = () => {
    if (!advCom.length) return
    exportToExcel(advCom, [
      { header: 'Fecha',        accessor: (c: any) => c.fechaEvento ? new Date(c.fechaEvento).toLocaleDateString('es-ES') : '' },
      { header: 'Tipo',         accessor: (c: any) => c.tipo + (c.subtipo ? ` (${c.subtipo})` : '') },
      { header: 'Nivel',        accessor: (c: any) => c.nivel || '' },
      { header: 'Promedio',     accessor: (c: any) => c.promedio },
      { header: 'Comentario',   accessor: (c: any) => c.comentario || '' },
      { header: 'IA Sentimiento', accessor: (c: any) => c.aiSentimiento || '' },
    ], `perf-eval-advisor_${(advisorsList.find(a => a._id === advisorId)?.nombre || advisorId).replace(/\s+/g, '_')}_${filterDates.startDate}_${filterDates.endDate}`)
  }

  const advisorSelected = advisorsList.find(a => a._id === advisorId)
  const isLoading = advisorStatsQ.isLoading || generalStatsQ.isLoading

  return (
    <div className="space-y-5">
      {/* Filtros: fechas + tipo + activos/inactivos/todos + dropdown advisor */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-end gap-2 flex-wrap">
        <div>
          <label htmlFor="bya-start" className="block text-xs text-gray-500 mb-1">Desde</label>
          <input id="bya-start" type="date" value={filterDates.startDate}
            onChange={e => onFilterDatesChange({ startDate: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="bya-end" className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input id="bya-end" type="date" value={filterDates.endDate}
            onChange={e => onFilterDatesChange({ endDate: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="bya-tipo" className="block text-xs text-gray-500 mb-1">Tipo</label>
          <select id="bya-tipo" value={filterDates.tipo}
            onChange={e => onFilterDatesChange({ tipo: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Todos</option>
            <option value="SESSION">Session</option>
            <option value="CLUB">Club</option>
          </select>
        </div>
        <div>
          <label htmlFor="bya-status" className="block text-xs text-gray-500 mb-1">Estado advisor</label>
          <select id="bya-status" value={advisorFilter}
            onChange={e => setAdvisorFilter(e.target.value as 'activos' | 'inactivos' | 'todos')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="flex-1 min-w-[260px]">
          <label htmlFor="bya-advisor" className="block text-xs text-gray-500 mb-1">
            Advisor <span className="text-gray-400">({advisorsList.length} disponibles)</span>
          </label>
          <select id="bya-advisor" value={advisorId}
            onChange={e => setAdvisorId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— Selecciona un advisor —</option>
            {advisorsList.map(a => (
              <option key={a._id} value={a._id}>
                {a.nombre} ({a.evaluaciones} evals){a.activo === false ? ' · Inactivo' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!advisorId && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-8 text-center">
          <UserCircleIcon className="h-12 w-12 text-indigo-400 mx-auto mb-2" />
          <p className="text-sm text-indigo-900 font-medium">Selecciona un advisor para ver sus métricas</p>
          <p className="text-xs text-indigo-700 mt-1">El dropdown filtra por estado ({advisorsList.length} {advisorFilter}).</p>
        </div>
      )}

      {advisorId && isLoading && (
        <div className="text-center text-sm text-gray-500 py-10">Cargando métricas…</div>
      )}

      {advisorId && !isLoading && advKpi && (
        <>
          {/* Header del advisor */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3 flex-wrap">
            <UserCircleIcon className="h-10 w-10 text-indigo-500" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900 truncate">{advisorSelected?.nombre || advisorId}</h2>
              <p className="text-xs text-gray-500">
                {advisorSelected?.activo === false ? <span className="text-gray-500">⚪ Inactivo · </span> : ''}
                {advKpi.totalEvaluaciones} evaluaciones · Promedio <span className="text-amber-600 font-bold">{advKpi.promedioGeneral} ★</span>
                {posicion && <span className="ml-2 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[11px] font-medium">Posición #{posicion.posicion} de {posicion.total}</span>}
              </p>
            </div>
            {canExport && (
              <button type="button" onClick={handleCSV} disabled={!advCom.length}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                <ArrowDownTrayIcon className="h-4 w-4" />CSV Comentarios
              </button>
            )}
          </div>

          {/* KPIs con comparativos */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCompare
              label="Total Evaluaciones"
              value={advKpi.totalEvaluaciones?.toLocaleString() ?? '—'}
              compare={genKpi ? `general: ${genKpi.totalEvaluaciones?.toLocaleString()}` : null}
            />
            <KpiCompare
              label="Promedio"
              value={advKpi.promedioGeneral != null ? `${advKpi.promedioGeneral} ★` : '—'}
              compare={genKpi?.promedioGeneral != null ? `general: ${genKpi.promedioGeneral} ★` : null}
              delta={renderDelta(Number(advKpi.promedioGeneral), Number(genKpi?.promedioGeneral))}
            />
            <KpiCompare
              label="Satisfacción ≥4★"
              value={advKpi.satisfaccionPct != null ? `${advKpi.satisfaccionPct}%` : '—'}
              compare={genKpi?.satisfaccionPct != null ? `general: ${genKpi.satisfaccionPct}%` : null}
              delta={renderDelta(Number(advKpi.satisfaccionPct), Number(genKpi?.satisfaccionPct), '%')}
            />
            <KpiCompare
              label="% con comentario"
              value={advKpi.pctConComentario != null ? `${advKpi.pctConComentario}%` : '—'}
              compare={genKpi?.pctConComentario != null ? `general: ${genKpi.pctConComentario}%` : null}
              delta={renderDelta(Number(advKpi.pctConComentario), Number(genKpi?.pctConComentario), '%')}
            />
            <KpiCompare
              label="Largo prom. coment."
              value={advKpi.largoPromedioComentario != null ? `${advKpi.largoPromedioComentario} car.` : '—'}
              compare={genKpi?.largoPromedioComentario != null ? `general: ${genKpi.largoPromedioComentario}` : null}
              delta={renderDelta(Number(advKpi.largoPromedioComentario), Number(genKpi?.largoPromedioComentario))}
            />
          </div>

          {/* Métricas por dimensión — advisor vs general */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Métricas por dimensión · advisor vs promedio general</h3>
              <p className="text-[11px] text-gray-400">Promedio del advisor en barra sólida; el promedio general aparece debajo como referencia.</p>
            </div>
            <div className="p-4">
              {advPorDim.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Sin datos</p> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left font-medium py-2">Dimensión</th>
                      <th className="text-right font-medium py-2 w-24">Advisor</th>
                      <th className="text-right font-medium py-2 w-24">General</th>
                      <th className="text-right font-medium py-2 w-20">Δ</th>
                      <th className="text-right font-medium py-2 w-20">≥4★</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advPorDim.map((d: any) => {
                      const gen = genPorDim.find((g: any) => g.dim === d.dim)
                      const diff = Number(d.promedio) - Number(gen?.promedio || 0)
                      return (
                        <tr key={d.dim} className="border-b border-gray-50 last:border-0">
                          <td className="py-3 font-medium text-gray-800">{DIM_LABELS[d.dim] || d.dim}</td>
                          <td className="py-3 text-right text-amber-600 font-bold">{d.promedio} ★</td>
                          <td className="py-3 text-right text-gray-500">{gen?.promedio ?? '—'} ★</td>
                          <td className={`py-3 text-right font-medium ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                            {diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`}
                          </td>
                          <td className="py-3 text-right text-gray-700">{d.satisfaccionPct}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Distribución + Evolución */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Distribución de calificaciones · {advisorSelected?.nombre || ''}</h3>
              {advDistr.length === 0 ? <p className="text-sm text-gray-400">Sin datos</p> : (
                <div className="space-y-2">
                  {advDistr.map((d: any) => (
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
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Evolución mensual · {advisorSelected?.nombre || ''}</h3>
              {advEvo.length === 0 ? <p className="text-sm text-gray-400">Sin datos</p> : (
                <div className="space-y-2">
                  {advEvo.map((e: any) => (
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

          {/* Comentarios del advisor */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Comentarios recibidos por {advisorSelected?.nombre || ''}</h3>
              <p className="text-[11px] text-gray-400">{advCom.length} {advCom.length === 1 ? 'comentario' : 'comentarios'}</p>
            </div>
            {advCom.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Sin comentarios en el período</p> : (
              <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {advCom.map((c: any) => (
                  <li key={c._id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
                      <span>{c.tipo}{c.subtipo ? ` (${c.subtipo})` : ''} · {c.nivel}</span>
                      <span>· {c.fechaEvento ? new Date(c.fechaEvento).toLocaleDateString('es-ES') : ''}</span>
                      {c.aiSentimiento && (
                        <span className={`px-1.5 rounded-full text-[10px] font-medium ${
                          c.aiSentimiento === 'positivo' ? 'bg-emerald-100 text-emerald-700'
                            : c.aiSentimiento === 'negativo' ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>{c.aiSentimiento}</span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-0.5 text-amber-600 font-bold">{c.promedio}★</span>
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.comentario}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** KPI con comparativo: valor principal grande, valor general pequeño abajo, delta a la derecha. */
function KpiCompare({ label, value, compare, delta }: { label: string; value: string; compare: string | null; delta?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <div className="flex items-end gap-2 flex-wrap">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {delta}
      </div>
      {compare && <p className="text-[11px] text-gray-500 truncate" title={compare}>{compare}</p>}
    </div>
  )
}
