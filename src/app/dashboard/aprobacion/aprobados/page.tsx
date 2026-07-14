'use client'

import { useState, useEffect } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AprobacionPermission } from '@/types/permissions'
import { Download, Filter, ChevronLeft, ChevronRight, User, AlertCircle, CheckCircle } from 'lucide-react'
import { exportToExcel } from '@/lib/export-excel'

interface Contrato {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  contrato: string
  campaign?: string
  celular: string
  email: string
  plataforma: string
  aprobacion?: string
  estado?: string
  estadoInactivo?: boolean
  finalContrato?: string
  _createdDate: Date
}

const RECORDS_PER_PAGE = 10

/** Estado consolidado del contrato (Finalizado > Inactivo > Aprobado). */
function estadoDe(c: Contrato): { key: 'Finalizado' | 'Inactivo' | 'Aprobado'; text: string; color: string } {
  if (c.aprobacion === 'FINALIZADA' || c.estado === 'FINALIZADA') {
    return { key: 'Finalizado', text: 'Finalizado', color: 'bg-red-100 text-red-800' }
  }
  if (c.estadoInactivo === true) {
    return { key: 'Inactivo', text: 'Inactivo', color: 'bg-gray-200 text-gray-800' }
  }
  return { key: 'Aprobado', text: 'Aprobado', color: 'bg-green-100 text-green-800' }
}

const ESTADOS = [
  { value: '', label: 'Todos (aprobados/inactivos/finalizados)' },
  { value: 'Aprobado', label: 'Aprobado' },
  { value: 'Inactivo', label: 'Inactivo' },
  { value: 'Finalizado', label: 'Finalizado' },
]

export default function AprobadosPage() {
  const [all, setAll] = useState<Contrato[]>([])
  const [rows, setRows] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('')
  const [fechaInicio, setFechaInicio] = useState<Date | null>(null)
  const [fechaFin, setFechaFin] = useState<Date | null>(null)
  const [page, setPage] = useState(1)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/postgres/approvals/aprobados', { cache: 'no-store' }).then(x => x.json())
      setAll(r.success && r.approvals ? r.approvals : [])
    } catch { setAll([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = (): Contrato[] => {
    let d = [...all]
    if (search.trim()) {
      const s = search.toLowerCase().trim()
      d = d.filter(c => `${c.primerApellido || ''} ${c.segundoApellido || ''} ${c.primerNombre || ''}`.toLowerCase().includes(s)
        || (c.contrato || '').toLowerCase().includes(s) || (c.numeroId || '').includes(s))
    }
    if (estado) d = d.filter(c => estadoDe(c).key === estado)
    if (fechaInicio) d = d.filter(c => new Date(c._createdDate) >= fechaInicio)
    if (fechaFin) { const f = new Date(fechaFin); f.setHours(23, 59, 59, 999); d = d.filter(c => new Date(c._createdDate) <= f) }
    return d
  }

  useEffect(() => {
    const d = filtered()
    setPage(1)
    setRows(d.slice(0, RECORDS_PER_PAGE))
  }, [all, search, estado, fechaInicio, fechaFin])

  const data = filtered()
  const totalPages = Math.ceil(data.length / RECORDS_PER_PAGE)
  const changePage = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    setRows(data.slice((p - 1) * RECORDS_PER_PAGE, p * RECORDS_PER_PAGE))
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AprobacionPermission.APROBADOS_VER} showDefaultMessage>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">✅ Aprobados</h1>
              <p className="mt-2 text-sm text-gray-700">Contratos aprobados, inactivos y finalizados</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => exportToExcel(data, [
                  { header: 'Nombre', accessor: (c) => `${c.primerNombre} ${c.primerApellido}`.trim() },
                  { header: 'Documento', accessor: (c) => c.numeroId },
                  { header: 'Contrato', accessor: (c) => c.contrato },
                  { header: 'Campaña', accessor: (c) => c.campaign || '' },
                  { header: 'Plataforma', accessor: (c) => c.plataforma },
                  { header: 'Celular', accessor: (c) => c.celular },
                  { header: 'Email', accessor: (c) => c.email },
                  { header: 'Estado', accessor: (c) => estadoDe(c).text },
                  { header: 'Fecha', accessor: (c) => new Date(c._createdDate).toLocaleDateString() },
                ], `aprobados-${new Date().toISOString().split('T')[0]}`)}
                disabled={data.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
              <button onClick={load}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2">
                <Filter className="w-4 h-4" /> Actualizar
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Buscar por apellido, nombre o contrato</label>
                <input type="text" placeholder="Apellido, nombre o contrato..." value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div className="lg:col-span-5">
                <label className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas</label>
                <div className="flex gap-2">
                  <input type="date" value={fechaInicio ? fechaInicio.toISOString().split('T')[0] : ''}
                    onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setFechaInicio(new Date(+y, +m - 1, +d)) } else setFechaInicio(null) }}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  <input type="date" value={fechaFin ? fechaFin.toISOString().split('T')[0] : ''}
                    onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setFechaFin(new Date(+y, +m - 1, +d)) } else setFechaFin(null) }}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Resultados + paginación */}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Registros ({data.length})</h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => changePage(page - 1)} disabled={page === 1}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-3 py-1 text-sm">{page} de {totalPages}</span>
                <button onClick={() => changePage(page + 1)} disabled={page === totalPages}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="card p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando contratos...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="card p-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Sin registros</h3>
              <p className="text-gray-500">No hay contratos aprobados/inactivos/finalizados con esos filtros.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Titular', 'Contrato', 'Campaña', 'Contacto', 'Estado', 'Fecha'].map(h => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {rows.map(c => {
                      const est = estadoDe(c)
                      return (
                        <tr key={c._id} className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => window.open(`/person/${c._id}`, '_blank')}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{c.primerNombre} {c.primerApellido}</div>
                                <div className="text-sm text-gray-500">{c.numeroId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{c.contrato}</div>
                            <div className="text-sm text-gray-500">{c.plataforma}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{c.campaign || '—'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{c.celular}</div>
                            <div className="text-sm text-gray-500">{c.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${est.color}`}>{est.text}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(c._createdDate).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
