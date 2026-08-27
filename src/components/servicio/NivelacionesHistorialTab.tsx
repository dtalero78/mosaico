'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  salon: string | null
  guiaId: string | null
  guia: string | null
  fecha: string | null
  fechaEvento: string | null
  estado: string | null
  modulo: string | null
  leccion: string | null
  conteo: number
  comentario: string | null
  marcadoPor: string | null
}
interface Guia { id: string; nombre: string }

const ESTADO_META: Record<string, { label: string; cls: string }> = {
  PENDIENTE:  { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700' },
  APROBADA:   { label: 'Aprobada',   cls: 'bg-blue-100 text-blue-700' },
  REALIZADA:  { label: 'Realizada',  cls: 'bg-green-100 text-green-700' },
  NO_ASISTIO: { label: 'No asistió', cls: 'bg-red-100 text-red-700' },
}

export default function NivelacionesHistorialTab() {
  const [guia, setGuia] = useState('')
  const [curso, setCurso] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones/historial?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // El servidor ya devuelve todo ordenado de la más reciente a la más antigua;
  // aquí sólo se parte en bloques por curso conservando ese orden, para que el
  // primer curso que aparece sea el de la nivelación más reciente.
  const grupos = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) {
      const k = r.curso || '— Sin curso —'
      const arr = map.get(k)
      if (arr) arr.push(r); else map.set(k, [r])
    }
    return Array.from(map.entries())
  }, [rows])

  const aplicar = () => fetchData({ guia, curso, startDate, endDate })
  const borrar = () => { setGuia(''); setCurso(''); setStartDate(''); setEndDate(''); fetchData() }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Módulo', accessor: r => r.modulo || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Estado', accessor: r => ESTADO_META[r.estado || '']?.label || r.estado || '' },
      { header: 'Fecha', accessor: r => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '') },
      { header: 'Comentario', accessor: r => r.comentario || '' },
    ], 'nivelaciones-historial')
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="hi-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select id="hi-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hi-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="hi-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hi-desde" className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input id="hi-desde" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="hi-hasta" className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input id="hi-hasta" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.NIVELACIONES_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!rows.length}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
          <span className="ml-auto text-sm text-gray-500">
            Total: <span className="font-semibold text-gray-700">{rows.length}</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Sin nivelaciones registradas</div>
      ) : (
        <div className="space-y-4">
          {grupos.map(([cursoNombre, filas]) => (
            <div key={cursoNombre} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                <span className="font-semibold text-gray-800">{cursoNombre}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">
                  {filas.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white border-b border-gray-100">
                    <tr>
                      {['Fecha', 'Nombre', 'Salón', 'Guía', 'Módulo · Lección', 'Conteo', 'Estado', 'Comentario'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((r, idx) => {
                      const meta = ESTADO_META[r.estado || ''] || { label: r.estado || '—', cls: 'bg-gray-100 text-gray-600' }
                      return (
                        <tr key={`${r.academicaId}-${r.fecha}-${idx}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                            {r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '—'}
                          </td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            <button type="button"
                              onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                              className="text-primary-600 hover:text-primary-800 hover:underline"
                              title="Ver perfil del beneficiario">
                              {r.nombre || '—'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.leccion || r.modulo
                              ? <span>{r.modulo ? <span className="text-gray-400">{r.modulo} · </span> : null}{r.leccion || '—'}</span>
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={r.comentario || ''}>{r.comentario || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
