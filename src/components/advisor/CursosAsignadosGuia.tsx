'use client'

import { useEffect, useMemo, useState } from 'react'

type Row = {
  campaign: string
  tipoCurso: string
  horarioCurso: string
  salon: string
  inicioCurso: string | null
  finalCurso: string | null
  finalCampaign: string | null
  numeroUsuarios: number
  usuInscritos: number
}

type Estado = 'matricula' | 'activo' | 'cerrado'

const ESTADO_META: Record<Estado, { label: string; cls: string }> = {
  matricula: { label: 'En matrícula', cls: 'bg-blue-100 text-blue-700' },
  activo:    { label: 'Activo',       cls: 'bg-green-100 text-green-700' },
  cerrado:   { label: 'Cerrado',      cls: 'bg-gray-200 text-gray-700' },
}

// Fecha local YYYY-MM-DD para comparar con las fechas puras de la BD.
const todayStr = () => new Date().toLocaleDateString('en-CA')

// Misma regla de estado que Consulta Cursos (por fecha).
function rowEstado(r: Row): Estado {
  const t = todayStr()
  const fc = r.finalCurso ? String(r.finalCurso).slice(0, 10) : ''
  const fcamp = r.finalCampaign ? String(r.finalCampaign).slice(0, 10) : ''
  if (fc && fc < t) return 'cerrado'          // el curso ya terminó
  if (fcamp && fcamp >= t) return 'matricula' // matrícula aún abierta
  return 'activo'                             // matrícula cerrada, curso en progreso
}

const d = (x: string | null) => (x ? String(x).slice(0, 10) : '—')

export default function CursosAsignadosGuia({ guiaId }: { guiaId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fCampana, setFCampana] = useState('')
  const [fCurso, setFCurso] = useState('')
  const [fEstado, setFEstado] = useState<'todos' | Estado>('todos')
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')

  useEffect(() => {
    if (!guiaId) return
    setLoading(true)
    setError(null)
    fetch(`/api/postgres/guias/${encodeURIComponent(guiaId)}/cursos-asignados`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        const rs: Row[] = Array.isArray(j.rows) ? j.rows : []
        setRows(rs)
        // Default: campaña actual (la que está en matrícula), si existe.
        const enMat = Array.from(new Set(rs.filter(r => rowEstado(r) === 'matricula').map(r => r.campaign))).sort()
        if (enMat.length) setFCampana(enMat[0])
      })
      .catch(() => setError('No se pudieron cargar los cursos asignados'))
      .finally(() => setLoading(false))
  }, [guiaId])

  const campanas = useMemo(() => Array.from(new Set(rows.map(r => r.campaign).filter(Boolean))).sort(), [rows])
  const cursos = useMemo(() => Array.from(new Set(rows.map(r => r.tipoCurso).filter(Boolean))), [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (fCampana && r.campaign !== fCampana) return false
    if (fCurso && r.tipoCurso !== fCurso) return false
    if (fEstado !== 'todos' && rowEstado(r) !== fEstado) return false
    const ini = r.inicioCurso ? String(r.inicioCurso).slice(0, 10) : ''
    if (fDesde && ini && ini < fDesde) return false
    if (fHasta && ini && ini > fHasta) return false
    return true
  }), [rows, fCampana, fCurso, fEstado, fDesde, fHasta])

  const limpiar = () => { setFCampana(''); setFCurso(''); setFEstado('todos'); setFDesde(''); setFHasta('') }

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      {/* Filtros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
          <select value={fCampana} onChange={e => setFCampana(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="">Todas</option>
            {campanas.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
          <select value={fCurso} onChange={e => setFCurso(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="">Todos</option>
            {cursos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
          <select value={fEstado} onChange={e => setFEstado(e.target.value as any)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
            <option value="todos">Todos</option>
            <option value="matricula">En matrícula</option>
            <option value="activo">Activo</option>
            <option value="cerrado">Cerrado</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
          <input type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
          <input type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
        </div>
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600">{filtered.length} curso(s)</p>
        <button type="button" onClick={limpiar} className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200">
          Limpiar filtros
        </button>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-500 text-sm">No hay cursos asignados con esos filtros.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Curso</th>
                <th className="py-2 pr-4 font-medium">Horario</th>
                <th className="py-2 pr-4 font-medium">Usuarios inscritos</th>
                <th className="py-2 pr-4 font-medium">Estado</th>
                <th className="py-2 pr-4 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const est = rowEstado(r)
                const full = r.usuInscritos >= r.numeroUsuarios && r.numeroUsuarios > 0
                return (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900">{r.tipoCurso} · Salón {r.salon}</div>
                      <div className="text-xs text-gray-400">{r.campaign}</div>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{r.horarioCurso}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${full ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-700'}`}>
                        {r.usuInscritos}/{r.numeroUsuarios}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_META[est].cls}`}>
                        {ESTADO_META[est].label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      <div>{d(r.inicioCurso)}</div>
                      <div className="text-xs text-gray-400">→ {d(r.finalCurso)}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
