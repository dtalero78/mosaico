'use client'

import { useState, useCallback, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import AdvisorScheduleFilters, { AdvisorFilterState } from './AdvisorScheduleFilters'
import AdvisorScheduleKpis   from './AdvisorScheduleKpis'
import AdvisorScheduleCharts from './AdvisorScheduleCharts'
import AdvisorScheduleRanking from './AdvisorScheduleRanking'
import AdvisorScheduleTable, { type SessionRow } from './AdvisorScheduleTable'
import AdvisorSessionDetailModal from './AdvisorSessionDetailModal'

const today       = new Date().toISOString().substring(0, 10)
const firstOfYear = `${new Date().getFullYear()}-01-01`

const DEFAULT_FILTERS: AdvisorFilterState = {
  fechaInicio: firstOfYear,
  fechaFin:    today,
  advisorId:   '',
  nivel:       '',
}

interface Advisor { _id: string; nombreCompleto: string }

interface ReportData {
  kpis: {
    totalSesiones: number; totalAdvisors: number; totalAgendados: number
    totalAsistieron: number; totalNoAsistieron: number
    porcentajeAsistencia: number; porcentajeInasistencia: number
  }
  ranking: any[]
  charts:  any
  table:   SessionRow[]
  meta:    { advisors: Advisor[]; niveles: string[] }
}

export default function AdvisorScheduleReportPage() {
  const [filters,    setFilters]    = useState<AdvisorFilterState>(DEFAULT_FILTERS)
  const [data,       setData]       = useState<ReportData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchData = useCallback(async (f: AdvisorFilterState) => {
    setLoading(true); setError(null)
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const qs = new URLSearchParams({
        fechaInicio: f.fechaInicio,
        fechaFin:    f.fechaFin,
        advisorId:   f.advisorId,
        nivel:       f.nivel,
        tz,
      })
      const res  = await fetch(`/api/postgres/reports/programacion/advisors?${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Error al cargar datos')
      setData(json.data ?? json)
    } catch (e: any) {
      setError(e.message || 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(DEFAULT_FILTERS) }, [fetchData])

  const handleApply = () => fetchData(filters)
  const handleClear = () => { setFilters(DEFAULT_FILTERS); fetchData(DEFAULT_FILTERS) }

  const modoAdvisor  = !!filters.advisorId
  const rankingTipo  = modoAdvisor ? 'nivel' : 'advisor'

  const emptyKpis = {
    totalSesiones: 0, totalAdvisors: 0, totalAgendados: 0,
    totalAsistieron: 0, totalNoAsistieron: 0,
    porcentajeAsistencia: 0, porcentajeInasistencia: 0,
  }
  const emptyCharts = {
    sesionesPorAdvisor: [], sesionesPorNivel: [],
    asistenciaPorAdvisor: [], asistenciaPorNivel: [],
    distribucionPorNivel: [], heatmapDiaHora: [],
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Informe de Sesiones por Advisor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Sesiones programadas (excluye Jumps, Clubs y Welcome)
            {modoAdvisor && <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Advisor seleccionado</span>}
          </p>
        </div>

        {/* Filters */}
        <AdvisorScheduleFilters
          filters={filters}
          onChange={setFilters}
          onApply={handleApply}
          onClear={handleClear}
          onExport={() => {/* handled in table */}}
          advisors={data?.meta?.advisors ?? []}
          niveles={data?.meta?.niveles ?? []}
          loading={loading}
        />

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            {error}
            <button type="button" onClick={handleApply} className="ml-auto text-xs underline hover:no-underline">Reintentar</button>
          </div>
        )}

        {/* KPIs */}
        <AdvisorScheduleKpis kpis={data?.kpis ?? emptyKpis} loading={loading} />

        {/* Ranking */}
        <AdvisorScheduleRanking
          data={data?.ranking ?? []}
          tipo={rankingTipo}
          loading={loading}
        />

        {/* Charts */}
        <AdvisorScheduleCharts
          charts={data?.charts ?? emptyCharts}
          advisorId={filters.advisorId}
          loading={loading}
        />

        {/* Table */}
        <AdvisorScheduleTable
          data={data?.table ?? []}
          loading={loading}
          onRowClick={row => setSelectedId(row._id)}
          filters={{ fechaInicio: filters.fechaInicio, fechaFin: filters.fechaFin }}
        />

      </div>

      {/* Session detail modal */}
      <AdvisorSessionDetailModal
        eventId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </DashboardLayout>
  )
}
