'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import ConfirmacionCell from '@/components/servicio/ConfirmacionCell'
import { usePermissions } from '@/hooks/usePermissions'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  numeroId: string | null
  salon: string | null
  modulo: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  guiaId: string | null
  conteo: number
  /** Cuándo la pidió el guía. */
  fechaSolicitud: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  eventoId: string | null
  eventoDia: string | null
  yaPaso: boolean
}
interface Guia { id: string; nombre: string }

/**
 * Nivelaciones ya agrupadas: tienen evento y esperan que se dicte y que el guía
 * marque la asistencia. Al cerrarse pasan al Histórico.
 */
export default function NivelacionesPendientesTab({ onCount }: { onCount?: (n: number) => void }) {
  const [curso, setCurso] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.NIVELACIONES_GESTION)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones/pendientes?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
      onCount?.(r.rows?.length || 0)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [onCount])

  useEffect(() => { fetchData() }, [fetchData])

  const aplicar = () => fetchData({ curso, leccion, guia })
  const borrar = () => { setCurso(''); setLeccion(''); setGuia(''); fetchData() }
  const fmt = (iso: string | null) => iso
    ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
  // La fecha del evento lleva hora (hace falta para ir a la sesión); la de
  // solicitud no, así que ocupa lo justo.
  const fmtDia = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es-CL') : '—'
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'ID', accessor: r => r.numeroId || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Módulo', accessor: r => r.modulo || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Fecha asignada', accessor: r => fmt(r.eventoDia) },
      { header: 'Confirmación', accessor: r => (r.confirmadoEn ? (r.confirmadoPor === 'SERVICIO' ? 'Confirmada (Servicio)' : 'Confirmada') : 'Sin confirmar') },
      { header: 'Estado', accessor: r => (r.yaPaso ? 'Dictada — falta marcar asistencia' : 'Programada') },
      { header: 'Fecha solicitud', accessor: r => fmtDia(r.fechaSolicitud) },
    ], 'nivelaciones-pendientes')
  }

  // Las que ya pasaron y siguen sin cerrarse son las que necesitan gestión.
  const vencidas = rows.filter(r => r.yaPaso).length

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="pe-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="pe-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pe-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select id="pe-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pe-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select id="pe-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
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
            {rows.length} agendada(s)
            {vencidas > 0 && <> · <span className="font-semibold text-amber-700">{vencidas} sin marcar asistencia</span></>}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
          No hay nivelaciones agendadas esperando que se dicten
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Fecha asignada', 'Curso', 'Nombre', 'Salón', 'Módulo · Lección', 'Guía', 'Conteo', 'Confirmación', 'Estado', 'Fecha solicitud'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.academicaId}-${r.eventoId}`} className={`border-b border-gray-100 hover:bg-gray-50 ${r.yaPaso ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{fmt(r.eventoDia)}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      <button type="button"
                        // Abre la ficha directamente en el modal "Detalles de la
                        // Clase" de ESTA nivelación: llegar a la ficha y tener que
                        // buscar la fila en el historial era el paso que sobraba.
                        onClick={() => window.open(
                          `/student/${r.academicaId}${r.eventoId ? `?clase=${encodeURIComponent(r.eventoId)}` : ''}`,
                          '_blank', 'noopener,noreferrer')}
                        className="text-primary-600 hover:text-primary-800 hover:underline"
                        title="Ver la nivelación en la ficha del beneficiario">
                        {r.nombre || '—'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.modulo && <span className="text-gray-400">{r.modulo} · </span>}
                      <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                      {r.tema && <span className="block text-xs text-gray-400 truncate max-w-[200px]" title={r.tema}>{r.tema}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                    </td>
                    <td className="px-3 py-2">
                      <ConfirmacionCell
                        academicaId={r.academicaId}
                        fechaSolicitud={r.fechaSolicitud}
                        confirmadoEn={r.confirmadoEn}
                        confirmadoPor={r.confirmadoPor}
                        puedeGestionar={canGestion}
                        onConfirmed={() => fetchData({ curso, leccion, guia })}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.yaPaso ? (
                        <button type="button"
                          onClick={() => r.eventoId && window.open(`/sesion/${r.eventoId}`, '_blank', 'noopener,noreferrer')}
                          title="Ir a la sesión para marcar la asistencia"
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200">
                          Falta marcar asistencia ↗
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Programada</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDia(r.fechaSolicitud)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
