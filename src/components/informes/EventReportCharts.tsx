'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, AreaChart, Area, Legend,
} from 'recharts'
import type { ChartsData, ReportConfig } from './event-report.types'
import { TYPE_COLORS } from './event-report.config'

interface Props {
  charts: ChartsData
  config: ReportConfig
  loading: boolean
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

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

// ── Heatmap custom component ──────────────────────────────────────────────────
const DAYS_ORDER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function Heatmap({ data }: { data: { dia: string; hora: string; total: number }[] }) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>

  const dias  = DAYS_ORDER.filter(d => data.some(r => r.dia === d))
  const horas = [...new Set(data.map(r => r.hora))].sort()
  const maxVal = Math.max(...data.map(r => r.total), 1)

  const getVal = (dia: string, hora: string) =>
    data.find(r => r.dia === dia && r.hora === hora)?.total ?? 0

  // Paleta azul-teal con texto legible: claro→oscuro texto, oscuro→blanco texto
  const PALETTE = [
    { bg: '#e0f2fe', text: '#0369a1' },  // sky-100 / sky-700
    { bg: '#7dd3fc', text: '#0c4a6e' },  // sky-300 / sky-900
    { bg: '#0ea5e9', text: '#ffffff' },  // sky-500 / white
    { bg: '#0369a1', text: '#ffffff' },  // sky-700 / white
    { bg: '#0c4a6e', text: '#ffffff' },  // sky-900 / white
  ]

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

// ── Main component ────────────────────────────────────────────────────────────
export default function EventReportCharts({ charts, config, loading }: Props) {
  if (loading) return <LoadingSkeleton />

  const noData = (arr: unknown[]) => arr.length === 0
    ? <p className="text-sm text-gray-400 text-center py-8">Sin datos para el período</p>
    : null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

      {/* 1. Sessions-Jumps: tarjeta separada por tipo */}
      {config.tiposPermitidos.includes('SESSION') && config.tiposPermitidos.includes('JUMP') ? (
        <>
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
        </>

      /* 1b. Training-Clubs: Training total + Clubes por tipo */
      ) : config.tiposPermitidos.includes('TRAINING') && config.tiposPermitidos.includes('CLUB') ? (
        <>
          <ChartCard title="Training Sessions">
            {(() => {
              const total = charts.eventosPorTipo.find(e => e.name === 'TRAINING')?.total ?? 0
              return total === 0
                ? <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
                : (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <span className="text-6xl font-bold" style={{ color: TYPE_COLORS.TRAINING }}>{total.toLocaleString()}</span>
                    <span className="text-sm text-gray-500 font-medium uppercase tracking-wide">eventos Training</span>
                  </div>
                )
            })()}
          </ChartCard>

          <ChartCard title="Clubes por Tipo">
            {noData(charts.clubsPorTipo) ?? (
              <ResponsiveContainer width="100%" height={Math.max(180, charts.clubsPorTipo.length * 32)}>
                <BarChart data={charts.clubsPorTipo} layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90}
                    tickFormatter={v => v.length > 12 ? `${v.slice(0, 11)}…` : v} />
                  <Tooltip formatter={(v: number) => [v, 'Eventos']} />
                  <Bar dataKey="total" fill={TYPE_COLORS.CLUB} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </>

      ) : (
        /* 1c. Welcome y otros: gráfico combinado */
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
      )}

      {/* 2. Eventos por Nivel — altura dinámica para mostrar todos los niveles */}
      <ChartCard title="Eventos por Nivel">
        {noData(charts.eventosPorNivel) ?? (
          <ResponsiveContainer width="100%" height={Math.max(220, charts.eventosPorNivel.length * 30)}>
            <BarChart data={charts.eventosPorNivel} layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v: number) => [v, 'Eventos']} />
              <Bar dataKey="total" fill={Object.values(config.colors)[0] ?? '#6366f1'} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Eventos por Hora */}
      <ChartCard title="Eventos por Hora">
        {noData(charts.eventosPorHora) ?? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.eventosPorHora} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [v, 'Eventos']} />
              <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4. Asistencia vs Inscritos */}
      <ChartCard title="Asistencia vs Inscritos (por fecha)">
        {noData(charts.asistenciaVsInscritos) ?? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={charts.asistenciaVsInscritos.slice(-30)}
              margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="gradInscritos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradAsistentes" x1="0" y1="0" x2="0" y2="1">
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
                stroke="#6366f1" fill="url(#gradInscritos)"  strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="asistentes" name="Asistentes"
                stroke="#10b981" fill="url(#gradAsistentes)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 5. Ranking Advisors */}
      <ChartCard title="Ranking Advisors por Eventos">
        {noData(charts.rankingAdvisors) ?? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={charts.rankingAdvisors.slice(0, 10)} layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80}
                tickFormatter={v => v.length > 14 ? `${v.slice(0, 13)}…` : v} />
              <Tooltip formatter={(v: number) => [v, 'Eventos']} />
              <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 6. Heatmap Día vs Hora */}
      <ChartCard title="Heatmap — Día vs Hora">
        <Heatmap data={charts.heatmapDiaHora} />
      </ChartCard>

    </div>
  )
}
