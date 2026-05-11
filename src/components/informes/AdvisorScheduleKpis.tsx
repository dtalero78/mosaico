'use client'

interface KpiData {
  totalSesiones:          number
  totalAdvisors:          number
  totalAgendados:         number
  totalAsistieron:        number
  totalNoAsistieron:      number
  porcentajeAsistencia:   number
  porcentajeInasistencia: number
}

interface Props { kpis: KpiData; loading: boolean }

function KpiCard({ label, value, color, sub }: {
  label: string; value: string | number; color: string; sub?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function AdvisorScheduleKpis({ kpis, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      <KpiCard label="Total Sesiones"    value={kpis.totalSesiones.toLocaleString()}     color="#3b82f6" />
      <KpiCard label="Total Advisors"    value={kpis.totalAdvisors.toLocaleString()}     color="#8b5cf6" />
      <KpiCard label="Usuarios Agendados" value={kpis.totalAgendados.toLocaleString()}   color="#6366f1" />
      <KpiCard label="Asistieron"         value={kpis.totalAsistieron.toLocaleString()}  color="#10b981" />
      <KpiCard label="No Asistieron"      value={kpis.totalNoAsistieron.toLocaleString()} color="#ef4444" />
      <KpiCard label="% Asistencia"       value={`${kpis.porcentajeAsistencia}%`}        color="#f59e0b"
        sub="asistieron / agendados" />
      <KpiCard label="% Inasistencia"     value={`${kpis.porcentajeInasistencia}%`}      color="#f97316"
        sub="no asistieron / agendados" />
    </div>
  )
}
