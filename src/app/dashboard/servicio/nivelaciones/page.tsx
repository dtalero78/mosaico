'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { usePermissions } from '@/hooks/usePermissions'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  salon: string | null
  leccion: string | null
  tema: string | null
  guia: string | null
  conteo: number
  fecha: string | null
}
interface Guia { id: string; nombre: string }

function NivelacionesContent() {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.NIVELACIONES_GESTION as any)

  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [salones, setSalones] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setSalones(r.salones || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const aplicar = () => fetchData({ curso, salon, leccion, guia, startDate, endDate })
  const borrar = () => {
    setCurso(''); setSalon(''); setLeccion(''); setGuia(''); setStartDate(''); setEndDate('')
    fetchData()
  }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Tema', accessor: r => r.tema || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Fecha', accessor: r => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '') },
    ], 'nivelaciones')
  }

  const accion = async (r: Row, tipo: 'aprobar' | 'cancelar') => {
    setActing(r.academicaId + tipo)
    try {
      const res = await fetch(`/api/postgres/students/${r.academicaId}/nivelacion`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [tipo]: true }),
      }).then(x => x.json())
      if (res.error) throw new Error(res.error)
      toast.success(tipo === 'aprobar' ? 'Nivelación aprobada' : 'Nivelación cancelada')
      // quitar la fila de la lista (ya resuelta)
      setRows(prev => prev.filter(x => x.academicaId !== r.academicaId))
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nivelaciones</h1>
      <p className="text-gray-500 mb-5">Estudiantes marcados para nivelación (pendientes). Total: <span className="font-semibold text-gray-700">{rows.length}</span></p>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select value={salon} onChange={e => setSalon(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Curso', 'Nombre', 'Salón', 'Lección (tema)', 'Guía', 'Conteo', 'Aprobar', 'Cancelar'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Sin nivelaciones pendientes</td></tr>
              ) : rows.map((r) => (
                <tr key={r.academicaId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.curso || '—'}</td>
                  <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.nombre || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="font-medium text-gray-800">{r.leccion || '—'}</span>
                    {r.tema && <span className="block text-xs text-gray-400">{r.tema}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" title="Aprobar nivelación"
                      onClick={() => accion(r, 'aprobar')}
                      disabled={!canGestion || acting === r.academicaId + 'aprobar'}
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <CheckCircleIcon className="h-6 w-6" />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" title="Cancelar nivelación"
                      onClick={() => accion(r, 'cancelar')}
                      disabled={!canGestion || acting === r.academicaId + 'cancelar'}
                      className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <XCircleIcon className="h-6 w-6" />
                    </button>
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

export default function NivelacionesPage() {
  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.NIVELACIONES_VER} showDefaultMessage>
        <NivelacionesContent />
      </PermissionGuard>
    </DashboardLayout>
  )
}
