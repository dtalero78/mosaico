'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, AreaChart, Area, Legend,
} from 'recharts'
import type { ChartsData, ChartPoint, TimeSeriesPoint, HeatmapPoint, ReportConfig } from './event-report.types'
import { TYPE_COLORS } from './event-report.config'

interface Props {
  charts: ChartsData
  config: ReportConfig
  loading: boolean
}

// ── Shared card wrapper ───────────────────────────────────────────────────────
function ChartCard({ title, children, accent }: {
  title: string; children: React.ReactNode; accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      {accent && <div className="w-8 h-1 rounded-full mb-3" style={{ backgroundColor: accent }} />}
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <div className="col-span-full flex items-center gap-3 pt-2">
      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <h2 className="text-base font-bold text-gray-800">{label}</h2>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  )
}

function noData(arr: unknown[]) {
  return arr.length === 0
    ? <p className="text-sm text-gray-400 text-center py-8">Sin datos para el período</p>
    : null
}

// ── Reusable chart renderers ──────────────────────────────────────────────────
function NivelChart({ data, color }: { data: ChartPoint[]; color: string }) {
  return noData(data) ?? (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={44} />
        <Tooltip formatter={(v: number) => [v, 'Eventos']} />
        <Bar dataKey="total" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function HoraChart({ data }: { data: ChartPoint[] }) {
  return noData(data) ?? (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 9 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [v, 'Eventos']} />
        <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AsistenciaChart({ data, gradId }: { data: TimeSeriesPoint[]; gradId: string }) {
  return noData(data) ?? (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data.slice(-30)} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={`${gradId}-ins`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${gradId}-asi`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="fecha" tick={{ fontSize: 9 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="inscritos"  name="Inscritos"
          stroke="#6366f1" fill={`url(#${gradId}-ins)`}  strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="asistentes" name="Asistentes"
          stroke="#10b981" fill={`url(#${gradId}-asi)`} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function RankingChart({ data }: { data: ChartPoint[] }) {
  return noData(data) ?? (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data.slice(0, 10)} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80}
          tickFormatter={v => v.length > 14 ? `${v.slice(0, 13)}…` : v} />
        <Tooltip formatter={(v: number) => [v, 'Eventos']} />
        <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
const DAYS_ORDER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const PALETTE = [
  { bg: '#e0f2fe', text: '#0369a1' },
  { bg: '#7dd3fc', text: '#0c4a6e' },
  { bg: '#0ea5e9', text: '#ffffff' },
  { bg: '#0369a1', text: '#ffffff' },
  { bg: '#0c4a6e', text: '#ffffff' },
]

function HeatmapGrid({ data }: { data: HeatmapPoint[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
  const dias  = DAYS_ORDER.filter(d => data.some(r => r.dia === d))
  const horas = [...new Set(data.map(r => r.hora))].sort()
  const maxVal = Math.max(...data.map(r => r.total), 1)
  const getVal = (dia: string, hora: string) =>
    data.find(r => r.dia === dia && r.hora === hora)?.total ?? 0
  const getCell = (val: number) => {
    if (val === 0) return { bg: '#f8fafc', text: 'transparent' }
    const idx = Math.min(Math.ceil((val / maxVal) * 5) - 1, 4)
    return { bg: PALETTE[idx].bg, text: PALETTE[idx].text }
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="p-1 text-gray-400 font-normal w-10" />
            {horas.map(h => (
              <th key={h} className="p-1 text-gray-500 font-medium text-center" style={{ minWidth: 38 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dias.map(dia => (
            <tr key={dia}>
              <td className="p-1 text-gray-500 font-semibold pr-2 whitespace-nowrap">{dia}</td>
              {horas.map(hora => {
                const val = getVal(dia, hora)
                const cell = getCell(val)
                return (
                  <td key={hora} title={`${dia} ${hora}: ${val}`}
                    className="p-0.5 text-center rounded cursor-default transition-colors"
                    style={{ backgroundColor: cell.bg, color: cell.text }}>
                    <span className="block text-[10px] font-bold leading-5 w-8 h-5 mx-auto">{val || ''}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EventReportCharts({ charts, config, loading }: Props) {
  if (loading) return <LoadingSkeleton />

  const isTrainingClubs = config.tiposPermitidos.includes('TRAINING') && config.tiposPermitidos.includes('CLUB')
  const isSessionsJumps = config.tiposPermitidos.includes('SESSION') && config.tiposPermitidos.includes('JUMP')

  // ── TRAINING-CLUBS: layout por secciones ─────────────────────────────────
  if (isTrainingClubs) {
    const tColor = TYPE_COLORS.TRAINING  // orange
    const cColor = TYPE_COLORS.CLUB      // green

    return (
      <div className="space-y-4">

        {/* ── FILA 1: Training ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <SectionLabel label="Training Sessions" color={tColor} />

          <ChartCard title="Training por Nivel" accent={tColor}>
            <NivelChart data={charts.trainingPorNivel ?? []} color={tColor} />
          </ChartCard>

          <ChartCard title="Training por Hora" accent={tColor}>
            <HoraChart data={charts.trainingPorHora ?? []} />
          </ChartCard>

          <ChartCard title="Training — Asistencia vs Inscritos" accent={tColor}>
            <AsistenciaChart data={charts.trainingAsistencia ?? []} gradId="train" />
          </ChartCard>
        </div>

        {/* ── FILA 2: Clubes ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <SectionLabel label="Clubes" color={cColor} />

          <ChartCard title="Clubes por Tipo" accent={cColor}>
            {noData(charts.clubsPorTipo) ?? (
              <ResponsiveContainer width="100%" height={Math.max(180, charts.clubsPorTipo.length * 32)}>
                <BarChart data={charts.clubsPorTipo} layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90}
                    tickFormatter={v => v.length > 12 ? `${v.slice(0, 11)}…` : v} />
                  <Tooltip formatter={(v: number) => [v, 'Eventos']} />
                  <Bar dataKey="total" fill={cColor} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Clubes por Nivel" accent={cColor}>
            <NivelChart data={charts.clubesPorNivel ?? []} color={cColor} />
          </ChartCard>

          <ChartCard title="Clubes — Asistencia vs Inscritos" accent={cColor}>
            <AsistenciaChart data={charts.clubesAsistencia ?? []} gradId="club" />
          </ChartCard>
        </div>

        {/* ── FILA 3: Ranking + Heatmap ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionLabel label="Ranking & Actividad" color="#6b7280" />

          <ChartCard title="Ranking Advisors — Training" accent={tColor}>
            <RankingChart data={charts.rankingAdvisorsTraining ?? []} />
          </ChartCard>

          <ChartCard title="Ranking Advisors — Clubes" accent={cColor}>
            <RankingChart data={charts.rankingAdvisorsClub ?? []} />
          </ChartCard>

          <ChartCard title="Heatmap Training — Día vs Hora" accent={tColor}>
            <HeatmapGrid data={charts.heatmapTraining ?? []} />
          </ChartCard>

          <ChartCard title="Heatmap Clubes — Día vs Hora" accent={cColor}>
            <HeatmapGrid data={charts.heatmapClub ?? []} />
          </ChartCard>
        </div>

      </div>
    )
  }

  // ── SESSIONS-JUMPS: tarjetas separadas + resto de gráficos ───────────────
  if (isSessionsJumps) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {['SESSION', 'JUMP'].map(tipo => {
          const total = charts.eventosPorTipo.find(e => e.name === tipo)?.total ?? 0
          const label = tipo === 'SESSION' ? 'Sessions' : 'Jumps'
          return (
            <ChartCard key={tipo} title={label}>
              {total === 0
                ? <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
                : (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <span className="text-6xl font-bold" style={{ color: TYPE_COLORS[tipo] }}>
                      {total.toLocaleString()}
                    </span>
                    <span className="text-sm text-gray-500 font-medium uppercase tracking-wide">
                      eventos {label}
                    </span>
                  </div>
                )
              }
            </ChartCard>
          )
        })}

        <ChartCard title="Eventos por Nivel">
          <NivelChart data={charts.eventosPorNivel} color={TYPE_COLORS.SESSION} />
        </ChartCard>

        <ChartCard title="Eventos por Hora">
          <HoraChart data={charts.eventosPorHora} />
        </ChartCard>

        <ChartCard title="Asistencia vs Inscritos (por fecha)">
          <AsistenciaChart data={charts.asistenciaVsInscritos} gradId="global" />
        </ChartCard>

        <ChartCard title="Ranking Advisors por Eventos">
          <RankingChart data={charts.rankingAdvisors} />
        </ChartCard>

        <ChartCard title="Heatmap — Día vs Hora">
          <HeatmapGrid data={charts.heatmapDiaHora} />
        </ChartCard>
      </div>
    )
  }

  // ── WELCOME y otros: layout genérico ────────────────────────────────────
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <ChartCard title="Eventos por Tipo">
        {noData(charts.eventosPorTipo) ?? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.eventosPorTipo} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [v, 'Eventos']} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {charts.eventosPorTipo.map(e => (
                  <Cell key={e.name} fill={TYPE_COLORS[e.name] ?? '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Eventos por Nivel">
        <NivelChart data={charts.eventosPorNivel} color={TYPE_COLORS.WELCOME} />
      </ChartCard>

      <ChartCard title="Eventos por Hora">
        <HoraChart data={charts.eventosPorHora} />
      </ChartCard>

      <ChartCard title="Asistencia vs Inscritos (por fecha)">
        <AsistenciaChart data={charts.asistenciaVsInscritos} gradId="welcome" />
      </ChartCard>

      <ChartCard title="Ranking Advisors por Eventos">
        <RankingChart data={charts.rankingAdvisors} />
      </ChartCard>

      <ChartCard title="Heatmap — Día vs Hora">
        <HeatmapGrid data={charts.heatmapDiaHora} />
      </ChartCard>
    </div>
  )
}
