'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AprobacionPermission } from '@/types/permissions'
import {
  Search,
  FileText,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
  User,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { debounce } from 'lodash'
import { exportToExcel } from '@/lib/export-excel'

// Tipos
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
  tipoUsuario: string
  aprobacion?: string
  hashConsentimiento?: string
  documentacion?: string[]
  _createdDate: Date
  fechaProximaGestion?: Date
}

interface FilterState {
  estado: string
  fechaInicio: Date | null
  fechaFin: Date | null
}

const ESTADOS_APROBACION = [
  { value: '', label: 'Todos los contratos' },
  { value: 'Aprobado', label: 'Aprobado', color: 'bg-green-100 text-green-800' },
  { value: 'Rechazado', label: 'Rechazado', color: 'bg-red-100 text-red-800' },
  { value: 'Pendiente', label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'En revisión', label: 'En revisión', color: 'bg-blue-100 text-blue-800' },
  { value: 'Firmado sin aprobar', label: 'Firmado sin aprobar', color: 'bg-orange-100 text-orange-800' },
  { value: 'Sin firmar', label: 'Sin firmar', color: 'bg-gray-100 text-gray-800' }
]

const RECORDS_PER_PAGE = 10 // Igual que en Wix APROBACION

export default function AprobacionPage() {
  const router = useRouter()

  // Estados principales
  const [contratos, setContratos] = useState<Contrato[]>([])
  const [allContratos, setAllContratos] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>({
    // Default = "Firmado sin aprobar" para que el aprobador entre directo al
    // backlog operativo (contratos que el cliente ya firmó y esperan visto bueno).
    estado: 'Firmado sin aprobar',
    fechaInicio: null,
    fechaFin: null
  })

  // Estados de paginación
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)

  // Estados de documentos
  const [selectedContrato, setSelectedContrato] = useState<Contrato | null>(null)
  const [showDocumentModal, setShowDocumentModal] = useState(false)
  const [uploadingDocs, setUploadingDocs] = useState(false)

  // Estado de búsqueda (filtrado local)
  const [searchApellido, setSearchApellido] = useState('')

  // Cargar contratos pendientes de aprobación (sin estado)
  const loadContratos = async () => {
    setLoading(true)
    try {
      console.log('🔍 Cargando registros pendientes de aprobación (sin estado)')
      const response = await fetch('/api/postgres/approvals/pending', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.approvals) {
          console.log('✅ Registros pendientes cargados:', result.count)
          setAllContratos(result.approvals)
          updatePagination(result.approvals)
        } else {
          console.error('Error en respuesta:', result.error)
          setAllContratos([])
          updatePagination([])
        }
      }
    } catch (error) {
      console.error('❌ Error al cargar registros pendientes:', error)
      setAllContratos([])
      updatePagination([])
    } finally {
      setLoading(false)
    }
  }

  // Actualizar paginación
  const updatePagination = (data: Contrato[]) => {
    const total = Math.ceil(data.length / RECORDS_PER_PAGE)
    setTotalPages(total)
    setCurrentPage(1)

    const startIndex = 0
    const endIndex = RECORDS_PER_PAGE
    setContratos(data.slice(startIndex, endIndex))
  }

  // Cambiar página
  const changePage = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return

    setCurrentPage(newPage)
    const startIndex = (newPage - 1) * RECORDS_PER_PAGE
    const endIndex = startIndex + RECORDS_PER_PAGE

    const filtered = getFilteredData()
    setContratos(filtered.slice(startIndex, endIndex))
  }

  // Obtener datos filtrados (incluye búsqueda local por apellido/nombre)
  const getFilteredData = (): Contrato[] => {
    let data = [...allContratos]

    // Filtrar por apellido/nombre (búsqueda local)
    if (searchApellido.trim()) {
      const searchTerm = searchApellido.toLowerCase().trim()
      data = data.filter(c => {
        const apellidoCompleto = `${c.primerApellido || ''} ${c.segundoApellido || ''}`.toLowerCase()
        const nombreCompleto = `${c.primerNombre || ''} ${c.primerApellido || ''}`.toLowerCase()
        return apellidoCompleto.includes(searchTerm) || nombreCompleto.includes(searchTerm)
      })
    }

    // Filtrar por estado
    if (filters.estado) {
      if (filters.estado === 'Firmado sin aprobar') {
        data = data.filter(c => c.hashConsentimiento && !c.aprobacion)
      } else if (filters.estado === 'Sin firmar') {
        data = data.filter(c => !c.hashConsentimiento && !c.aprobacion)
      } else {
        data = data.filter(c => c.aprobacion === filters.estado)
      }
    }

    // Filtrar por fechas
    if (filters.fechaInicio) {
      data = data.filter(c => new Date(c._createdDate) >= filters.fechaInicio!)
    }
    if (filters.fechaFin) {
      // Ajustar fechaFin para incluir todo el día (hasta las 23:59:59.999)
      const fechaFinAjustada = new Date(filters.fechaFin)
      fechaFinAjustada.setHours(23, 59, 59, 999)
      data = data.filter(c => new Date(c._createdDate) <= fechaFinAjustada)
    }

    return data
  }

  // Aplicar filtros automáticamente cuando cambian los filtros o la búsqueda
  useEffect(() => {
    if (allContratos.length > 0) {
      const filtered = getFilteredData()
      updatePagination(filtered)
    }
  }, [searchApellido, filters.estado, filters.fechaInicio, filters.fechaFin])

  // Obtener estado display
  const getEstadoDisplay = (contrato: Contrato) => {
    if (contrato.hashConsentimiento && !contrato.aprobacion) {
      return { text: 'Firmado sin aprobar', color: 'bg-orange-100 text-orange-800' }
    } else if (contrato.aprobacion) {
      const estado = ESTADOS_APROBACION.find(e => e.value === contrato.aprobacion)
      return {
        text: contrato.aprobacion,
        color: estado?.color || 'bg-gray-100 text-gray-800'
      }
    } else if (!contrato.hashConsentimiento && !contrato.aprobacion) {
      return { text: 'Sin firmar - Sin aprobar', color: 'bg-gray-100 text-gray-800' }
    }
    return { text: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' }
  }

  // Cambiar estado de aprobación
  const updateAprobacion = async (contratoId: string, nuevoEstado: string) => {
    try {
      const response = await fetch(`/api/postgres/approvals/${contratoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estado: nuevoEstado === 'Aprobado' ? 'APROBADO' : 'RECHAZADO'
        })
      })

      if (response.ok) {
        // Actualizar estado local
        setAllContratos(prev => prev.map(c =>
          c._id === contratoId ? { ...c, aprobacion: nuevoEstado } : c
        ))
        setContratos(prev => prev.map(c =>
          c._id === contratoId ? { ...c, aprobacion: nuevoEstado } : c
        ))

        // Si se aprobó, remover de la lista después de un delay
        if (nuevoEstado === 'Aprobado') {
          setTimeout(() => {
            setAllContratos(prev => prev.filter(c => c._id !== contratoId))
            setContratos(prev => prev.filter(c => c._id !== contratoId))
          }, 1500)
        }
      }
    } catch (error) {
      console.error('Error al actualizar aprobación:', error)
    }
  }

  // Descargar contrato PDF
  const downloadContrato = (contratoId: string) => {
    const downloadUrl = `https://bsl-utilidades-yp78a.ondigitalocean.app/descargar-pdf-drive/${contratoId}?empresa=LGS`
    window.open(downloadUrl, '_blank')
  }

  // Ver documentación
  const viewDocuments = (contrato: Contrato) => {
    setSelectedContrato(contrato)
    setShowDocumentModal(true)
  }

  // Subir documentos
  const uploadDocuments = async (files: FileList) => {
    if (!selectedContrato) return

    setUploadingDocs(true)
    try {
      // Aquí implementarías la lógica de subida
      // Por ahora simularemos con un timeout
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log('Documentos subidos:', files.length)

      // Actualizar el contrato con nuevos documentos
      // Esto debería hacerse mediante API

      setUploadingDocs(false)
      setShowDocumentModal(false)
    } catch (error) {
      console.error('Error al subir documentos:', error)
      setUploadingDocs(false)
    }
  }

  // useEffects
  useEffect(() => {
    loadContratos()
  }, [])


  return (
    <DashboardLayout>
      <PermissionGuard permission={AprobacionPermission.ACTUALIZAR}>
        <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🛡️ Centro de Aprobaciones</h1>
            <p className="mt-2 text-sm text-gray-700">
              Gestión de aprobaciones administrativas y contratos
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => exportToExcel(getFilteredData(), [
                { header: 'Nombre', accessor: (c) => `${c.primerNombre} ${c.primerApellido}`.trim() },
                { header: 'Documento', accessor: (c) => c.numeroId },
                { header: 'Contrato', accessor: (c) => c.contrato },
                { header: 'Plataforma', accessor: (c) => c.plataforma },
                { header: 'Celular', accessor: (c) => c.celular },
                { header: 'Email', accessor: (c) => c.email },
                { header: 'Estado', accessor: (c) => getEstadoDisplay(c).text },
                { header: 'Fecha', accessor: (c) => new Date(c._createdDate).toLocaleDateString() },
              ], `aprobaciones-${new Date().toISOString().split('T')[0]}`)}
              disabled={getFilteredData().length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar Excel
            </button>
            <button
              onClick={() => loadContratos()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Filter className="w-4 h-4" />
              Actualizar
            </button>
          </div>
        </div>

        {/* Barra de búsqueda y filtros */}
        <div className="card p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
            {/* Búsqueda por apellido/nombre */}
            <div className="lg:col-span-4">
              <label htmlFor="searchApellido" className="block text-sm font-medium text-gray-700 mb-1">
                Buscar por apellido o nombre
              </label>
              <input
                type="text"
                id="searchApellido"
                placeholder="Apellido o nombre..."
                value={searchApellido}
                onChange={(e) => setSearchApellido(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Filtro de estado */}
            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estado
              </label>
              <select
                value={filters.estado}
                onChange={(e) => setFilters(prev => ({ ...prev, estado: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {ESTADOS_APROBACION.map(estado => (
                  <option key={estado.value} value={estado.value}>
                    {estado.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Rango de fechas */}
            <div className="lg:col-span-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rango de fechas
              </label>
              <div className="flex gap-2">
              <input
                type="date"
                value={filters.fechaInicio ? filters.fechaInicio.toISOString().split('T')[0] : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    // Crear fecha en zona horaria local, a las 00:00:00
                    const [year, month, day] = e.target.value.split('-')
                    const fecha = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0)
                    setFilters(prev => ({ ...prev, fechaInicio: fecha }))
                  } else {
                    setFilters(prev => ({ ...prev, fechaInicio: null }))
                  }
                }}
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Desde"
              />
              <input
                type="date"
                value={filters.fechaFin ? filters.fechaFin.toISOString().split('T')[0] : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    // Crear fecha en zona horaria local, a las 00:00:00
                    const [year, month, day] = e.target.value.split('-')
                    const fecha = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0)
                    setFilters(prev => ({ ...prev, fechaFin: fecha }))
                  } else {
                    setFilters(prev => ({ ...prev, fechaFin: null }))
                  }
                }}
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Hasta"
              />
              </div>
            </div>
          </div>
        </div>

        {/* Información de resultados */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            {searchApellido || filters.estado || filters.fechaInicio || filters.fechaFin
              ? `Registros filtrados (${getFilteredData().length})`
              : `Registros pendientes de aprobación (${allContratos.length})`
            }
          </h2>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => changePage(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 text-sm">
                {currentPage} de {totalPages}
              </span>

              <button
                onClick={() => changePage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Lista de contratos */}
        {loading ? (
          <div className="card p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando contratos...</p>
          </div>
        ) : contratos.length === 0 ? (
          <div className="card p-12 text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No hay registros pendientes de aprobación
            </h3>
            <p className="text-gray-500">
              No se encontraron registros sin estado que requieran aprobación
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Titular
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contrato
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contacto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {contratos.map(contrato => {
                    const estado = getEstadoDisplay(contrato)
                    return (
                      <tr
                        key={contrato._id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => window.open(`/person/${contrato._id}`, '_blank')}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0">
                              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                                <User className="h-5 w-5 text-blue-600" />
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {contrato.primerNombre} {contrato.primerApellido}
                              </div>
                              <div className="text-sm text-gray-500">
                                {contrato.numeroId}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{contrato.contrato}</div>
                          <div className="text-sm text-gray-500">{contrato.plataforma}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{contrato.celular}</div>
                          <div className="text-sm text-gray-500">{contrato.email}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${estado.color}`}>
                            {estado.text}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(contrato._createdDate).toLocaleDateString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal de documentos */}
        {showDocumentModal && selectedContrato && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">
                  Documentación de {selectedContrato.primerNombre} {selectedContrato.primerApellido}
                </h3>
                <button
                  onClick={() => setShowDocumentModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              {selectedContrato.documentacion && selectedContrato.documentacion.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {selectedContrato.documentacion.map((doc, index) => (
                    <div key={index} className="border rounded-lg p-3 flex items-center justify-between">
                      <span className="text-sm truncate flex-1">
                        Documento {index + 1}
                      </span>
                      <button
                        onClick={() => window.open(doc, '_blank')}
                        className="ml-2 text-blue-600 hover:text-blue-800"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  No hay documentación subida
                </p>
              )}

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subir nuevos documentos
                </label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => e.target.files && uploadDocuments(e.target.files)}
                  className="w-full"
                />
                {uploadingDocs && (
                  <p className="text-sm text-blue-600 mt-2">Subiendo documentos...</p>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}