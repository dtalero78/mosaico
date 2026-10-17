'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { estadoCurso, ESTADO_CURSO_META, type EstadoCurso } from '@/lib/cursos-campaign'

type Row = {
  _id: string
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

type Inscrito = {
  peopleId: string
  academicaId: string | null
  numeroId: string
  nombre: string
  estadoContrato: string
  aprobacion: string | null
}

type Estado = EstadoCurso

const ESTADO_META = ESTADO_CURSO_META

// Regla única en `lib/cursos-campaign` (7 días de gracia + corte 09:00 Chile).
const rowEstado = (r: Row): Estado => estadoCurso(r)

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

  // Modal de inscritos (clic en el globo de inscritos)
  const [modalCurso, setModalCurso] = useState<Row | null>(null)
  const [inscritos, setInscritos] = useState<Inscrito[] | null>(null)
  const [inscritosError, setInscritosError] = useState<string | null>(null)

  // Sólo pinta la última consulta pedida: si se abre otro curso antes de que
  // responda el anterior, la respuesta vieja no pisa al modal nuevo.
  const pedidoRef = useRef(0)

  const abrirInscritos = (r: Row) => {
    const n = ++pedidoRef.current
    setModalCurso(r)
    setInscritos(null)
    setInscritosError(null)
    fetch(`/api/postgres/guias/${encodeURIComponent(guiaId)}/cursos-asignados/${encodeURIComponent(r._id)}/inscritos`, { cache: 'no-store' })
      .then(async res => {
        const j = await res.json().catch(() => ({}))
        if (!res.ok || j.success === false) throw new Error(j.error || 'No se pudieron cargar los inscritos')
        if (n === pedidoRef.current) setInscritos(Array.isArray(j.items) ? j.items : [])
      })
      .catch(e => { if (n === pedidoRef.current) setInscritosError(e?.message || 'No se pudieron cargar los inscritos') })
  }

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
                      <button type="button" onClick={() => abrirInscritos(r)} title="Ver usuarios inscritos"
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer hover:ring-2 hover:ring-offset-1 ${full ? 'bg-yellow-100 text-yellow-800 hover:ring-yellow-300' : 'bg-green-100 text-green-700 hover:ring-green-300'}`}>
                        {r.usuInscritos}/{r.numeroUsuarios}
                      </button>
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

      {/* Modal: usuarios inscritos del curso/salón */}
      {modalCurso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setModalCurso(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Inscritos · {modalCurso.tipoCurso} · Salón {modalCurso.salon || '—'}
                </h3>
                <p className="text-xs text-gray-500">
                  {modalCurso.campaign} · {modalCurso.horarioCurso} · {modalCurso.usuInscritos}/{modalCurso.numeroUsuarios} cupos
                </p>
              </div>
              <button type="button" onClick={() => setModalCurso(null)} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto">
              {inscritosError ? (
                <p className="p-5 text-sm text-red-600">{inscritosError}</p>
              ) : inscritos === null ? (
                <p className="p-5 text-sm text-gray-500">Cargando…</p>
              ) : inscritos.length === 0 ? (
                <p className="p-5 text-sm text-gray-500">Sin usuarios inscritos en este salón.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 w-8">#</th>
                      <th className="text-left px-4 py-2">Nombre</th>
                      <th className="text-left px-4 py-2">ID</th>
                      <th className="text-left px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inscritos.map((b, i) => {
                      const e = b.estadoContrato || b.aprobacion || 'Pendiente'
                      const cls = e === 'Aprobado' ? 'text-emerald-600'
                        : e === 'Devuelto' ? 'text-blue-600'
                        : e === 'Pendiente' ? 'text-amber-600'
                        : 'text-red-600'
                      return (
                        <tr key={b.peopleId} className="border-b last:border-0">
                          <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-4 py-2 text-gray-900">
                            {b.academicaId
                              ? <a href={`/student/${b.academicaId}`} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline">{b.nombre}</a>
                              : b.nombre}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-gray-700">{b.numeroId}</td>
                          <td className="px-4 py-2"><span className={`text-xs ${cls}`}>{e}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t bg-gray-50 flex justify-end">
              <button type="button" onClick={() => setModalCurso(null)} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
