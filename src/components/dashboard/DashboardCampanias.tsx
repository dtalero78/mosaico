'use client'

/**
 * Bloque "Campañas y cursos" del dashboard admin (rol NO-ADVISOR):
 *   1. Campañas por estado: En matrícula (o mensaje si no hay), Activas, Cerradas
 *      — cada una con inscritos y cursos.
 *   2. Usuarios activos / inactivos (beneficiarios).
 *   3. Cursos activos por tipo (YOJI/OKINA/KODOMO/DANSHI/SENPAI/IMPULSA).
 *
 * Datos: `/api/postgres/dashboard/campanias?tz=...` (React Query, mismo patrón
 * que DashboardMonthlyCharts).
 */

import { useMemo } from 'react'
import { useQuery } from 'react-query'

interface Campania {
  campaign: string
  cursos: number
  inscritos: number
  cupos: number
  cierreMatricula: string | null
  finalCursoMax: string | null
}
interface CursoTipo { tipo: string; cursos: number; inscritos: number }
interface Data {
  enMatricula: Campania[]
  activas: Campania[]
  cerradas: Campania[]
  usuarios: { activos: number; inactivos: number }
  cursosActivosPorTipo: CursoTipo[]
  totalCursosActivos: number
}

function clientTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota' }
  catch { return 'America/Bogota' }
}

// Colores por tipo de curso (mismos que el panel del estudiante).
const TIPO_COLOR: Record<string, string> = {
  YOJI: 'bg-green-500', OKINA: 'bg-amber-500', KODOMO: 'bg-blue-500',
  DANSHI: 'bg-orange-500', SENPAI: 'bg-red-500', IMPULSA: 'bg-fuchsia-500',
}

function fmtFecha(s: string | null): string {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function DashboardCampanias() {
  const { data, isLoading, error } = useQuery<Data>(
    'dashboard-campanias',
    async () => {
      const r = await fetch(`/api/postgres/dashboard/campanias?tz=${encodeURIComponent(clientTz())}`)
      const j = await r.json()
      if (!j.success) throw new Error(j.error || 'Error cargando campañas')
      return j as Data
    },
    { staleTime: 5 * 60 * 1000, refetchInterval: 10 * 60 * 1000 },
  )

  const cursoMax = useMemo(
    () => data?.cursosActivosPorTipo.reduce((m, t) => Math.max(m, t.cursos), 0) ?? 0,
    [data],
  )

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto mb-2"></div>
        Cargando campañas y cursos…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-red-600">
        No se pudieron cargar las campañas.
      </div>
    )
  }

  const CampCard = ({ c, tono }: { c: Campania; tono: string }) => (
    <div className={`rounded-lg border px-3 py-2 ${tono}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900 text-sm">{c.campaign}</span>
        <span className="text-xs font-medium text-gray-600">
          {c.inscritos}{c.cupos ? `/${c.cupos}` : ''} matriculados
        </span>
      </div>
      <div className="mt-0.5 text-xs text-gray-500">
        {c.cursos} curso{c.cursos === 1 ? '' : 's'}
        {c.cierreMatricula ? ` · cierre matrícula ${fmtFecha(c.cierreMatricula)}` : ''}
      </div>
    </div>
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {/* ── Campañas ── */}
      <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Campañas</h3>

        {/* En matrícula */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
            <span className="text-sm font-medium text-gray-700">En matrícula</span>
          </div>
          {data.enMatricula.length === 0 ? (
            <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500 text-center">
              No hay ninguna campaña en matrícula
            </div>
          ) : (
            <div className="space-y-2">
              {data.enMatricula.map(c => <CampCard key={c.campaign} c={c} tono="bg-blue-50 border-blue-200" />)}
            </div>
          )}
        </div>

        {/* Activas */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-sm font-medium text-gray-700">Activas ({data.activas.length})</span>
          </div>
          {data.activas.length === 0 ? (
            <p className="text-sm text-gray-400">Ninguna</p>
          ) : (
            <div className="space-y-2">
              {data.activas.map(c => <CampCard key={c.campaign} c={c} tono="bg-green-50 border-green-200" />)}
            </div>
          )}
        </div>

        {/* Cerradas */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-gray-400"></span>
            <span className="text-sm font-medium text-gray-700">Cerradas ({data.cerradas.length})</span>
          </div>
          {data.cerradas.length === 0 ? (
            <p className="text-sm text-gray-400">Ninguna</p>
          ) : (
            <div className="space-y-2">
              {data.cerradas.map(c => <CampCard key={c.campaign} c={c} tono="bg-gray-50 border-gray-200" />)}
            </div>
          )}
        </div>
      </div>

      {/* ── Columna derecha: usuarios + cursos por tipo ── */}
      <div className="space-y-6">
        {/* Usuarios activos/inactivos */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Usuarios</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
              <div className="text-2xl font-bold text-green-700">{data.usuarios.activos}</div>
              <div className="text-xs text-gray-600 mt-1">Activos</div>
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
              <div className="text-2xl font-bold text-red-700">{data.usuarios.inactivos}</div>
              <div className="text-xs text-gray-600 mt-1">Inactivos</div>
            </div>
          </div>
        </div>

        {/* Cursos activos por tipo */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Cursos activos por tipo</h3>
            <span className="text-sm text-gray-500">{data.totalCursosActivos} total</span>
          </div>
          {data.cursosActivosPorTipo.length === 0 ? (
            <p className="text-sm text-gray-400">Sin cursos activos</p>
          ) : (
            <div className="space-y-2">
              {data.cursosActivosPorTipo.map(t => (
                <div key={t.tipo} className="flex items-center gap-2">
                  <span className="w-16 text-xs font-medium text-gray-700">{t.tipo}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-4 ${TIPO_COLOR[t.tipo] || 'bg-primary-500'}`}
                      style={{ width: `${cursoMax ? (t.cursos / cursoMax) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-6 text-xs font-semibold text-gray-800 text-right tabular-nums">{t.cursos}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
