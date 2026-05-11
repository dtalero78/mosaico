'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

interface ChartPoint { name: string; total: number }
interface AsistPoint  { name: string; asistieron: number; noAsistieron: number }
interface HeatPoint   { dia: string; hora: string; total: number }

interface ChartsData {
  sesionesPorAdvisor:   ChartPoint[]
  sesionesPorNivel:     ChartPoint[]
  asistenciaPorAdvisor: AsistPoint[]
  asistenciaPorNivel:   AsistPoint[]
  distribucionPorNivel: ChartPoint[]
  heatmapDiaHora:       HeatPoint[]
}

interface Props {
  charts:    ChartsData
  advisorId: string
  loading:   boolean
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function NoData() {
  return <p className="text-sm text-gray-400 text-center py-8">Sin datos para el período</p>
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
const DAYS_ORDER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const PALETTE_BLUE = [
  { bg: '#e0f2fe', text: '#0369a1' },
  { bg: '#7dd3fc', text: '#0c4a6e' },
  { bg: '#0ea5e9', text: '#ffffff' },
  { bg: '#0369a1', text: '#ffffff' },
  { bg: '#0c4a6e', text: '#ffffff' },
]

function HeatmapGrid({ data }: { data: HeatPoint[] }) {
  if (!data.length) return <NoData />
  const dias  = DAYS_ORDER.filter(d => data.some(r => r.dia === d))
  const horas = [...new Set(data.map(r => r.hora))].sort()
  const maxVal = Math.max(...data.map(r => r.total), 1)
  const getVal = (dia: string, hora: string) =>
    data.find(r => r.dia === dia && r.hora === hora)?.total ?? 0
  const getCell = (val: number) => {
    if (val === 0) return { bg: '#f8fafc', text: 'transparent' }
    const idx = Math.min(Math.ceil((val / maxVal) * 5) - 1, 4)
    return { bg: PALETTE_BLUE[idx].bg, text: PALETTE_BLUE[idx].text }
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="p-1 text-gray-400 font-normal w-10" scope="col" aria-label="Día" />
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
                const val  = getVal(dia, hora)
                const cell = getCell(val)
                return (
                  <td key={hora} title={`${dia} ${hora}: ${val}`}
                    className="p-0.5 text-center rounded cursor-default"
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
export default function AdvisorScheduleCharts({ charts, advisorId, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
            <div className="h-48 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    )
  }

  const modoAdvisor = !!advisorId

  const sesiones    = modoAdvisor ? charts.sesionesPorNivel    : charts.sesionesPorAdvisor
  const asistencias = modoAdvisor ? charts.asistenciaPorNivel  : charts.asistenciaPorAdvisor
  const titleSes    = modoAdvisor ? 'Sesiones por Nivel'       : 'Sesiones por Advisor'
  const titleAsis   = modoAdvisor ? 'Asistencia por Nivel'     : 'Asistencia por Advisor'

  const tickFmt = (v: string) => v.length > 14 ? `${v.slice(0, 13)}…` : v

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

      {/* 1. Sesiones (dinámico) */}
      <ChartCard title={titleSes}>
        {!sesiones.length ? <NoData /> : (
          <ResponsiveContainer width="100%" height={Math.max(220, sesiones.length * 30)}>
            <BarChart data={sesiones} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90}
                tickFormatter={tickFmt} />
              <Tooltip formatter={(v: number) => [v, 'Sesiones']} />
              <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 2. Asistencia vs No asistencia (dinámico) */}
      <ChartCard title={titleAsis}>
        {!asistencias.length ? <NoData /> : (
          <ResponsiveContainer width="100%" height={Math.max(220, asistencias.length * 30)}>
            <BarChart data={asistencias} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90}
                tickFormatter={tickFmt} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="asistieron"   name="Asistieron"   fill="#10b981" radius={[0, 0, 0, 0]} stackId="a" />
              <Bar dataKey="noAsistieron" name="No asistieron" fill="#ef4444" radius={[0, 4, 4, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 3. Distribución por nivel (siempre visible) */}
      <ChartCard title="Distribución por Nivel">
        {!charts.distribucionPorNivel.length ? <NoData /> : (
          <ResponsiveContainer width="100%" height={Math.max(220, charts.distribucionPorNivel.length * 30)}>
            <BarChart data={charts.distribucionPorNivel} layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v: number) => [v, 'Sesiones']} />
              <Bar dataKey="total" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* 4. Heatmap */}
      <ChartCard title="Heatmap — Día vs Hora">
        <HeatmapGrid data={charts.heatmapDiaHora} />
      </ChartCard>

    </div>
  )
}
