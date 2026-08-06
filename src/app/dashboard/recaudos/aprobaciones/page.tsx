'use client'

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { exportToExcel } from '@/lib/export-excel'
import { User, Filter, Download, ChevronLeft, ChevronRight, AlertCircle, UserCheck } from 'lucide-react'

interface Contrato {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  contrato: string
  celular: string
  email: string
  plataforma: string
  gestorRecaudo?: string | null
  _createdDate: Date
  fechaIngreso?: string | Date | null
}

interface Gestor { _id: string; nombre: string | null; rol: string }

const GESTOR_ROLES = ['RECAUDOS_ASESOR', 'RECAUDOS_JEFE']
const GESTOR_LABEL: Record<string, string> = { RECAUDOS_ASESOR: 'Asesor', RECAUDOS_JEFE: 'Jefe' }
const RECORDS_PER_PAGE = 10
const fmtDate = (v: any) => v ? new Date(v).toLocaleDateString() : ''

export default function RecaudosAprobacionesPage() {
  const { hasPermission } = usePermissions()
  const canAssign = hasPermission(RecaudosPermission.APROBACIONES_ASIGNAR)

  const [allContratos, setAllContratos] = useState<Contrato[]>([])
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [searchApellido, setSearchApellido] = useState('')
  const [plataformaFiltro, setPlataformaFiltro] = useState('')
  const [fechaInicio, setFechaInicio] = useState<Date | null>(null)
  const [fechaFin, setFechaFin] = useState<Date | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)

  // Asignación
  const [gestores, setGestores] = useState<Gestor[]>([])
  const [gestorTarget, setGestorTarget] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showConfirm, setShowConfirm] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const loadContratos = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postgres/recaudos/aprobaciones')
      const json = await res.json()
      setAllContratos(json?.success && json.approvals ? json.approvals : [])
    } catch (e) {
      console.error('Error cargando aprobaciones:', e)
      setAllContratos([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadContratos() }, [])

  useEffect(() => {
    if (!canAssign) return
    fetch(`/api/postgres/users/by-role?roles=${GESTOR_ROLES.join(',')}&activeOnly=true`)
      .then(r => r.json())
      .then(j => setGestores(j?.success && j.users ? j.users : []))
      .catch(() => setGestores([]))
  }, [canAssign])

  const plataformasDisponibles = [...new Set(allContratos.map(c => c.plataforma).filter(Boolean) as string[])].sort()

  const getFilteredData = (): Contrato[] => {
    let data = [...allContratos]
    if (searchApellido.trim()) {
      const t = searchApellido.toLowerCase().trim()
      data = data.filter(c => {
        const ap = `${c.primerApellido || ''} ${c.segundoApellido || ''}`.toLowerCase()
        const nom = `${c.primerNombre || ''} ${c.primerApellido || ''}`.toLowerCase()
        return ap.includes(t) || nom.includes(t)
      })
    }
    if (plataformaFiltro) data = data.filter(c => (c.plataforma || '') === plataformaFiltro)
    if (fechaInicio) data = data.filter(c => new Date(c._createdDate) >= fechaInicio)
    if (fechaFin) {
      const ff = new Date(fechaFin); ff.setHours(23, 59, 59, 999)
      data = data.filter(c => new Date(c._createdDate) <= ff)
    }
    return data
  }

  const updatePagination = (data: Contrato[]) => {
    setTotalPages(Math.ceil(data.length / RECORDS_PER_PAGE))
    setCurrentPage(1)
    setContratos(data.slice(0, RECORDS_PER_PAGE))
  }

  const changePage = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setCurrentPage(newPage)
    const start = (newPage - 1) * RECORDS_PER_PAGE
    setContratos(getFilteredData().slice(start, start + RECORDS_PER_PAGE))
  }

  useEffect(() => {
    updatePagination(getFilteredData())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allContratos, searchApellido, plataformaFiltro, fechaInicio, fechaFin])

  const filtered = getFilteredData()
  // Asignables = filtrados SIN gestor
  const asignablesFiltrados = filtered.filter(c => !c.gestorRecaudo)
  const allVisibleSelected = asignablesFiltrados.length > 0 && asignablesFiltrados.every(c => selectedIds.has(c._id))

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (asignablesFiltrados.every(c => prev.has(c._id))) return new Set()
      return new Set(asignablesFiltrados.map(c => c._id))
    })
  }

  const gestorNombre = (id: string) => {
    const g = gestores.find(x => x._id === id)
    return g ? `${g.nombre || 'Sin nombre'}${g.rol ? ` · ${GESTOR_LABEL[g.rol] || g.rol}` : ''}` : ''
  }

  const openConfirm = () => {
    if (!gestorTarget) { toast.error('Selecciona un gestor de recaudo'); return }
    if (selectedIds.size === 0) { toast.error('Selecciona al menos un contrato'); return }
    setShowConfirm(true)
  }

  const doAssign = async () => {
    setAssigning(true)
    try {
      const res = await fetch('/api/postgres/recaudos/asignar-masivo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), gestorRecaudo: gestorTarget }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.details || json?.error || `Error ${res.status}`)
      toast.success(`${json.asignados} contrato(s) asignado(s) a ${json.gestorNombre}`)
      setShowConfirm(false)
      setSelectedIds(new Set())
      setGestorTarget('')
      await loadContratos()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo asignar')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.APROBACIONES_VER} showDefaultMessage>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">📝 Aprobaciones</h1>
              <p className="mt-2 text-sm text-gray-700">
                Contratos aprobados activos — asignación de gestor de recaudo
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => exportToExcel(filtered, [
                  { header: 'Titular', accessor: (c) => `${c.primerNombre} ${c.primerApellido}`.trim() },
                  { header: 'Documento', accessor: (c) => c.numeroId },
                  { header: 'Contrato', accessor: (c) => c.contrato },
                  { header: 'Fecha Contrato', accessor: (c) => fmtDate(c._createdDate) },
                  { header: 'Celular', accessor: (c) => c.celular },
                  { header: 'Email', accessor: (c) => c.email },
                  { header: 'Plataforma', accessor: (c) => c.plataforma || '' },
                  { header: 'Asignado', accessor: (c) => c.gestorRecaudo ? 'Sí' : 'No' },
                  { header: 'Fecha Aprobación', accessor: (c) => fmtDate(c.fechaIngreso) },
                ], `recaudos-aprobaciones-${new Date().toISOString().split('T')[0]}`)}
                disabled={filtered.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
              <button
                type="button"
                onClick={() => loadContratos()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Filter className="w-4 h-4" /> Actualizar
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4">
                <label htmlFor="searchApellido" className="block text-sm font-medium text-gray-700 mb-1">Buscar por apellido o nombre</label>
                <input type="text" id="searchApellido" placeholder="Apellido o nombre..." value={searchApellido}
                  onChange={(e) => setSearchApellido(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Plataforma</label>
                <select value={plataformaFiltro} onChange={(e) => setPlataformaFiltro(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">Todas</option>
                  {plataformasDisponibles.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="lg:col-span-5">
                <label className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas (contrato)</label>
                <div className="flex gap-2">
                  <input type="date"
                    value={fechaInicio ? fechaInicio.toISOString().split('T')[0] : ''}
                    onChange={(e) => e.target.value ? (() => { const [y, m, d] = e.target.value.split('-'); setFechaInicio(new Date(+y, +m - 1, +d)) })() : setFechaInicio(null)}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  <input type="date"
                    value={fechaFin ? fechaFin.toISOString().split('T')[0] : ''}
                    onChange={(e) => e.target.value ? (() => { const [y, m, d] = e.target.value.split('-'); setFechaFin(new Date(+y, +m - 1, +d)) })() : setFechaFin(null)}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>
            </div>
            {canAssign && (
              <div className="mt-3 flex items-end justify-between gap-4">
                <span className="text-sm text-gray-600 pb-2">{selectedIds.size} seleccionado(s)</span>
                <div className="flex items-end gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gestor de Recaudos (destino)</label>
                    <select value={gestorTarget} onChange={(e) => setGestorTarget(e.target.value)}
                      className="min-w-[240px] px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                      <option value="">Selecciona…</option>
                      {gestores.map(g => (
                        <option key={g._id} value={g._id}>{g.nombre || 'Sin nombre'} · {GESTOR_LABEL[g.rol] || g.rol}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={openConfirm}
                    disabled={selectedIds.size === 0 || !gestorTarget}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <UserCheck className="w-4 h-4" /> Asignación masiva
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Resultados + paginación */}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Registros filtrados ({filtered.length})</h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1}
                  className="p-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-3 py-1 text-sm">{currentPage} de {totalPages}</span>
                <button type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage === totalPages}
                  className="p-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="card p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando contratos...</p>
            </div>
          ) : contratos.length === 0 ? (
            <div className="card p-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No hay contratos</h3>
              <p className="text-gray-500">No se encontraron contratos con los filtros aplicados</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {canAssign && (
                        <th className="px-4 py-3 text-left">
                          <input type="checkbox" title="Seleccionar todos (sin gestor)" checked={allVisibleSelected} onChange={toggleSelectAll}
                            className="h-4 w-4 rounded border-gray-300" />
                        </th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Titular</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contrato</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Contrato</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plataforma</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asignado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Aprobación</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {contratos.map(contrato => {
                      const yaAsignado = !!contrato.gestorRecaudo
                      return (
                        <tr key={contrato._id} className={`hover:bg-gray-50 ${selectedIds.has(contrato._id) ? 'bg-purple-50' : ''}`}>
                          {canAssign && (
                            <td className="px-4 py-4">
                              <input
                                type="checkbox"
                                title={yaAsignado ? 'Ya tiene gestor asignado' : 'Seleccionar'}
                                disabled={yaAsignado}
                                checked={selectedIds.has(contrato._id)}
                                onChange={() => toggleSelect(contrato._id)}
                                className="h-4 w-4 rounded border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </td>
                          )}
                          <td className="px-6 py-4 whitespace-nowrap cursor-pointer" onClick={() => window.open(`/person/${contrato._id}`, '_blank')}>
                            <div className="flex items-center">
                              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                                <User className="h-5 w-5 text-blue-600" />
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{contrato.primerNombre} {contrato.primerApellido}</div>
                                <div className="text-sm text-gray-500">{contrato.numeroId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{contrato.contrato}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{fmtDate(contrato._createdDate)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{contrato.celular}</div>
                            <div className="text-sm text-gray-500">{contrato.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{contrato.plataforma || '—'}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${yaAsignado ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                              {yaAsignado ? 'Sí' : 'No'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{fmtDate(contrato.fechaIngreso)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal de confirmación */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !assigning && setShowConfirm(false)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-purple-600" /> Confirmar asignación masiva
              </h3>
              <p className="mt-4 text-sm text-gray-700">
                Se asignarán <strong>{selectedIds.size}</strong> contrato(s) al ejecutivo de recaudos:
              </p>
              <p className="mt-1 text-base font-semibold text-purple-700">{gestorNombre(gestorTarget)}</p>
              <p className="mt-3 text-xs text-gray-500">
                Solo se asignan contratos sin gestor previo. Esta acción actualiza el gestor de recaudo de cada titular seleccionado.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setShowConfirm(false)} disabled={assigning}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50">Cancelar</button>
                <button type="button" onClick={doAssign} disabled={assigning}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded hover:bg-purple-700 disabled:opacity-50">
                  {assigning ? 'Asignando…' : 'Confirmar asignación'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
