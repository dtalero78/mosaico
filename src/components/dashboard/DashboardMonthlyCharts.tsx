'use client'

/**
 * Visualizaciones globales del mes corriente para el dashboard admin
 * (cualquier rol NO-ADVISOR):
 *   1. Donut con 3 buckets disjuntos: Asistieron / Canceladas / No asistieron
 *   2. Barras horizontales con sesiones agendadas por nivel
 *
 * Datos: `/api/postgres/dashboard/monthly?tz=...` (2 queries paralelas en
 * dashboard.service.getMonthlyAggregates). Caché client-side via React Query
 * (staleTime 5min, refetchInterval 10min) — mismo patrón que DashboardStats.
 *
 * El heatmap Día×Hora se eliminó (2026-06-09) — no se usaba operativamente
 * y reduce 1 query pesada (GROUP BY weekday × hour sobre todos los bookings
 * del mes) a la BD por cada carga del dashboard.
 */

import { useMemo } from 'react'
import { useQuery } from 'react-query'

interface MonthlyData {
  donut: { asistieron: number; canceladas: number; noAsistieron: number }
  porNivel: { nivel: string; total: number }[]
  monthLabel: string
}

function clientTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' }
  catch { return 'America/Bogota' }
}

export default function DashboardMonthlyCharts() {
  const { data, isLoading, error } = useQuery<MonthlyData>(
    'dashboard-monthly',
    async () => {
      const r = await fetch(`/api/postgres/dashboard/monthly?tz=${encodeURIComponent(clientTz())}`)
      const j = await r.json()
      if (!j.success) throw new Error(j.error || 'Error cargando agregados mensuales')
      return { donut: j.donut, porNivel: j.porNivel, monthLabel: j.monthLabel }
    },
    { staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 },
  )

  const nivelMax = useMemo(
    () => data?.porNivel.reduce((m, r) => Math.max(m, r.total), 0) ?? 0,
    [data],
  )

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
        Cargando agregados del mes…
      </div>
    )
  }
  if (error || !data) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">No se pudo cargar la información del mes.</div>
  }

  const totalDonut = data.donut.asistieron + data.donut.canceladas + data.donut.noAsistieron

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <DonutCard
        title="Sesiones del mes"
        subtitle={data.monthLabel}
        total={totalDonut}
        segments={[
          { label: 'Asistieron',    value: data.donut.asistieron,   color: '#22c55e' },
          { label: 'No asistieron', value: data.donut.noAsistieron, color: '#f97316' },
          { label: 'Canceladas',    value: data.donut.canceladas,   color: '#ef4444' },
        ]}
      />
      <NivelBarChart
        title="Sesiones agendadas por nivel"
        subtitle={data.monthLabel}
        items={data.porNivel}
        max={nivelMax}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Donut SVG (mismo patrón que welcome-session/page.tsx + AdvisorDashboard)
// ────────────────────────────────────────────────────────────────────────

function DonutCard({ title, subtitle, total, segments }: {
  title: string
  subtitle: string
  total: number
  segments: { label: string; value: number; color: string }[]
}) {
  const r = 60, cx = 75, cy = 75, sw = 24
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-500 capitalize">{subtitle}</span>
      </div>
      {total === 0 ? (
        <div className="flex items-center justify-center h-[150px] text-sm text-gray-400">
          Sin datos para este mes
        </div>
      ) : (
        <div className="flex items-center gap-6 flex-wrap">
          <svg width="150" height="150" viewBox="0 0 150 150">
            {segments.map((seg, i) => {
              if (!seg.value) return null
              const pct = seg.value / total
              const dash = pct * circ
              const gap = circ - dash
              const rot = offset * 360 - 90
              offset += pct
              return (
                <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                  stroke={seg.color} strokeWidth={sw}
                  strokeDasharray={`${dash} ${gap}`}
                  strokeLinecap="butt"
                  transform={`rotate(${rot} ${cx} ${cy})`}
                />
              )
            })}
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="bold" fill="#1f2937">
              {total.toLocaleString()}
            </text>
            <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#6b7280">TOTAL</text>
          </svg>

          <div className="space-y-2 flex-1 min-w-[180px]">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-gray-600 flex-1">{seg.label}</span>
                <span className="font-semibold text-gray-900 w-12 text-right">{seg.value.toLocaleString()}</span>
                <span className="text-gray-400 text-xs w-12 text-right">
                  {total > 0 ? `${((seg.value / total) * 100).toFixed(1)}%` : '0%'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Barras horizontales por nivel con etiquetas (sin Recharts — CSS puro)
// ────────────────────────────────────────────────────────────────────────

function NivelBarChart({ title, subtitle, items, max }: {
  title: string
  subtitle: string
  items: { nivel: string; total: number }[]
  max: number
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-xs text-gray-500 capitalize">{subtitle}</span>
      </div>
      {items.length === 0 || max === 0 ? (
        <div className="flex items-center justify-center h-[150px] text-sm text-gray-400">
          Sin sesiones agendadas este mes
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(it => {
            const pct = Math.max(1, (it.total / max) * 100)
            return (
              <div key={it.nivel} className="flex items-center gap-2 text-xs">
                <span className="w-14 text-right font-medium text-gray-700 truncate" title={it.nivel}>
                  {it.nivel}
                </span>
                <div className="flex-1 bg-gray-100 rounded h-5 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500 rounded"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-10 text-left font-semibold text-gray-900 tabular-nums">
                  {it.total.toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
