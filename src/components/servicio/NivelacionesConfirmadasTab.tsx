'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  numeroId: string | null
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  fechaSolicitud: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  eventoDia: string | null
}
interface Guia { id: string; nombre: string }

const fmtFechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const quien = (p: string | null) => (p === 'SERVICIO' ? 'Servicio' : 'Usuario')

/**
 * Nivelaciones CONFIRMADAS: ya tienen su evento agendado y el usuario (o
 * Servicio/administrador) confirmó que asistirá. Siguen aquí hasta que se dicta
 * y se marca la asistencia; entonces pasan al Histórico. Sólo lectura.
 */
export default function NivelacionesConfirmadasTab({ onCount, refreshKey = 0 }: {
  onCount?: (n: number) => void
  refreshKey?: number
}) {
  const [usuario, setUsuario] = useState('')
  const [curso, setCurso] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  /** '' = todas las agendadas, 'confirmadas' o 'sin' (sin confirmar). */
  const [estado, setEstado] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [soloPropios, setSoloPropios] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones/confirmadas?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
      setSoloPropios(!!r.soloPropios)
      onCount?.(r.rows?.length || 0)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [onCount])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (!refreshKey) return
    aplicar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const aplicar = () => fetchData({ usuario, curso, leccion, guia, estado })
  const borrar = () => { setUsuario(''); setCurso(''); setLeccion(''); setGuia(''); setEstado(''); fetchData() }
  const exportar = () => exportToExcel(rows, [
    { header: 'Fecha solicitud', accessor: r => (r.fechaSolicitud ? new Date(r.fechaSolicitud).toLocaleDateString('es-CL') : '') },
    { header: 'Curso', accessor: r => r.curso || '' },
    { header: 'Nombre', accessor: r => r.nombre || '' },
    { header: 'ID', accessor: r => r.numeroId || '' },
    { header: 'Salón', accessor: r => r.salon || '' },
    { header: 'Lección', accessor: r => r.leccion || '' },
    { header: 'Tema', accessor: r => r.tema || '' },
    { header: 'Fecha asignada', accessor: r => fmtFechaHora(r.eventoDia) },
    { header: 'Guía', accessor: r => r.guia || '' },
    { header: 'Confirmada por', accessor: r => quien(r.confirmadoPor) },
    { header: 'Confirmada el', accessor: r => fmtFechaHora(r.confirmadoEn) },
  ], 'nivelaciones-confirmadas')

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="nc-usuario" className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
            <input id="nc-usuario" type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }} placeholder="Nombre o documento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="nc-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="nc-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="nc-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select id="nc-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="nc-estado" className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
            <select id="nc-estado" value={estado} onChange={e => setEstado(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>
              <option value="confirmadas">Confirmadas</option>
              <option value="sin">Sin confirmar</option>
            </select>
          </div>
          {!soloPropios && (
            <div>
              <label htmlFor="nc-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
              <select id="nc-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
          )}
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
            Agendadas: <span className="font-semibold text-gray-700">{rows.length}</span>
          </span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha asignada', 'Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Confirmada'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">Sin nivelaciones agendadas</td></tr>
              ) : rows.map(r => (
                <tr key={r.academicaId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap font-medium">{fmtFechaHora(r.eventoDia)}</td>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    <button type="button"
                      onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                      className="text-primary-600 hover:text-primary-800 hover:underline" title="Ver perfil del beneficiario">
                      {r.nombre || '—'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                    {r.tema && <span className="block text-xs text-gray-400 truncate max-w-[220px]" title={r.tema}>{r.tema}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.confirmadoEn ? (<>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700"
                        title={`Confirmada por ${quien(r.confirmadoPor)} el ${fmtFechaHora(r.confirmadoEn)}`}>
                        ✓ {quien(r.confirmadoPor)}
                      </span>
                      <span className="block text-xs text-gray-400 mt-0.5">{fmtFechaHora(r.confirmadoEn)}</span>
                    </>) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Sin confirmar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
