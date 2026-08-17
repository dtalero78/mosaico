'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { ServicioPermission } from '@/types/permissions'
import {
  User,
  ArrowLeft,
  RefreshCw,
  Download,
  Search,
  Filter,
  Users,
  AlertCircle,
  MessageCircle
} from 'lucide-react'
import { exportToExcel } from '@/lib/export-excel'
import { normalizeNumeroId } from '@/lib/numeroid-normalize'

interface Beneficiario {
  _id: string
  primerNombre: string
  segundoNombre?: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  email?: string
  celular?: string
  telefono?: string
  contrato?: string
  campaign?: string
  _createdDate: string
}

interface Stats {
  totalBeneficiarios: number
  totalRegistrosAcademicos: number
  beneficiariosSinRegistro: number
}

export default function SinRegistroPage() {
  const router = useRouter()
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sendingWhatsApp, setSendingWhatsApp] = useState<string | null>(null)
  const [whatsAppSent, setWhatsAppSent] = useState<Set<string>>(new Set())
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null)

  // Estados para filtros
  const [filteredBeneficiarios, setFilteredBeneficiarios] = useState<Beneficiario[]>([])
  const [campaignFilter, setCampaignFilter] = useState('')
  const [idFilter, setIdFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Las campañas del dropdown salen de los propios registros: así nunca se
  // ofrece una opción que devolvería la lista vacía.
  const campaigns = useMemo(
    () => Array.from(new Set(beneficiarios.map(b => (b.campaign || '').trim()).filter(Boolean))).sort(),
    [beneficiarios]
  )

  const loadBeneficiariosSinRegistro = async () => {
    setLoading(true)
    setError(null)

    try {
      console.log('🔍 Cargando beneficiarios sin registro...')

      const response = await fetch('/api/postgres/people/beneficiarios-sin-registro')

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Beneficiarios sin registro recibidos:', data)

      if (data.success && data.beneficiarios) {
        setBeneficiarios(data.beneficiarios)
        setFilteredBeneficiarios(data.beneficiarios)
        if (data.stats) {
          setStats(data.stats)
        }
      } else {
        throw new Error(data.error || 'Error desconocido al cargar beneficiarios')
      }
    } catch (err: any) {
      console.error('❌ Error cargando beneficiarios sin registro:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBeneficiariosSinRegistro()
  }, [])

  useEffect(() => {
    let filtered = [...beneficiarios]

    // Filter by search query
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(beneficiario =>
        beneficiario.primerNombre?.toLowerCase().includes(query) ||
        beneficiario.primerApellido?.toLowerCase().includes(query) ||
        beneficiario.numeroId?.includes(query) ||
        beneficiario.email?.toLowerCase().includes(query) ||
        beneficiario.contrato?.toLowerCase().includes(query)
      )
    }

    // Filter by campaign
    if (campaignFilter) {
      filtered = filtered.filter(b => (b.campaign || '').trim() === campaignFilter)
    }

    // Filter by documento. Se compara normalizado (sin puntos, guiones ni
    // espacios y en mayúsculas) para que '24.777.856-k' encuentre '24777856K'.
    if (idFilter.trim()) {
      const needle = normalizeNumeroId(idFilter)
      if (needle) {
        filtered = filtered.filter(b => normalizeNumeroId(b.numeroId).includes(needle))
      }
    }

    // Filter by date range
    if (startDate || endDate) {
      filtered = filtered.filter(beneficiario => {
        const createdDate = new Date(beneficiario._createdDate)

        if (startDate) {
          // Crear fecha usando componentes para evitar problemas de zona horaria
          const [year, month, day] = startDate.split('-').map(Number)
          const start = new Date(year, month - 1, day, 0, 0, 0, 0)
          if (createdDate < start) return false
        }

        if (endDate) {
          // Crear fecha usando componentes para evitar problemas de zona horaria
          const [year, month, day] = endDate.split('-').map(Number)
          const end = new Date(year, month - 1, day, 23, 59, 59, 999)
          if (createdDate > end) return false
        }

        return true
      })
    }

    setFilteredBeneficiarios(filtered)
  }, [searchQuery, beneficiarios, campaignFilter, idFilter, startDate, endDate])

  const handleSendWhatsApp = async (beneficiario: Beneficiario) => {
    if (!beneficiario.celular && !beneficiario.telefono) {
      setWhatsAppError('Este beneficiario no tiene número de teléfono registrado')
      setTimeout(() => setWhatsAppError(null), 5000)
      return
    }

    setSendingWhatsApp(beneficiario._id)
    setWhatsAppError(null)

    try {
      const phoneNumber = beneficiario.celular || beneficiario.telefono
      const fullName = `${beneficiario.primerNombre} ${beneficiario.segundoNombre || ''} ${beneficiario.primerApellido} ${beneficiario.segundoApellido || ''}`.trim()

      const response = await fetch('/api/wix/sendWelcomeWhatsApp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          celular: phoneNumber,
          beneficiarioId: beneficiario._id,
          nombre: fullName
        })
      })

      const data = await response.json()

      if (data.success) {
        // Add to sent set permanently
        setWhatsAppSent(prev => new Set(prev).add(beneficiario._id))
        console.log('✅ WhatsApp enviado exitosamente a', fullName)
      } else {
        throw new Error(data.error || 'Error al enviar WhatsApp')
      }
    } catch (err: any) {
      console.error('❌ Error enviando WhatsApp:', err)
      setWhatsAppError(`Error: ${err.message}`)
      setTimeout(() => setWhatsAppError(null), 5000)
    } finally {
      setSendingWhatsApp(null)
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setCampaignFilter('')
    setIdFilter('')
    setStartDate('')
    setEndDate('')
  }

  const handleExportExcel = () => {
    exportToExcel(filteredBeneficiarios, [
      { header: 'Nombre', accessor: (b) => `${b.primerNombre} ${b.segundoNombre || ''}`.trim() },
      { header: 'Apellido', accessor: (b) => `${b.primerApellido} ${b.segundoApellido || ''}`.trim() },
      { header: 'Documento', accessor: (b) => b.numeroId },
      { header: 'Email', accessor: (b) => b.email },
      { header: 'Teléfono', accessor: (b) => b.celular || b.telefono },
      { header: 'Contrato', accessor: (b) => b.contrato },
      { header: 'Campaña', accessor: (b) => b.campaign },
      { header: 'Fecha Creación', accessor: (b) => new Date(b._createdDate).toLocaleDateString() },
    ], `beneficiarios-sin-registro-${new Date().toISOString().split('T')[0]}`)
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={ServicioPermission.USUARIOS_ACTUALIZAR}>
        <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Usuarios sin perfil creado</h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadBeneficiariosSinRegistro}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>

            <button
              onClick={handleExportExcel}
              disabled={filteredBeneficiarios.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar Excel
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600 font-medium">Total Beneficiarios</p>
                  <p className="text-2xl font-bold text-blue-700">{stats.totalBeneficiarios}</p>
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-sm text-green-600 font-medium">Con Registro Académico</p>
                  <p className="text-2xl font-bold text-green-700">{stats.totalRegistrosAcademicos}</p>
                </div>
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-8 h-8 text-orange-600" />
                <div>
                  <p className="text-sm text-orange-600 font-medium">Sin Registro</p>
                  <p className="text-2xl font-bold text-orange-700">{stats.beneficiariosSinRegistro}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 mb-6">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, documento, email o contrato..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="text-sm text-gray-600">
                {filteredBeneficiarios.length} de {beneficiarios.length} beneficiarios
              </div>
            </div>

            {/* Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label htmlFor="f-campaign" className="block text-sm font-medium text-gray-700 mb-1">
                  Campaña
                </label>
                <select
                  id="f-campaign"
                  value={campaignFilter}
                  onChange={(e) => setCampaignFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="">Todas</option>
                  {campaigns.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="f-id" className="block text-sm font-medium text-gray-700 mb-1">
                  ID (documento)
                </label>
                <input
                  id="f-id"
                  type="text"
                  placeholder="Ej. 24777856K"
                  value={idFilter}
                  onChange={(e) => setIdFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha desde
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha hasta
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={clearFilters}
                  className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Limpiar filtros
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* WhatsApp Error Message */}
        {whatsAppError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-700 font-medium">Error al enviar WhatsApp</p>
            </div>
            <p className="text-red-600 mt-1">{whatsAppError}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-700 font-medium">Error al cargar datos</p>
            </div>
            <p className="text-red-600 mt-1">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            <span className="ml-3 text-gray-600">Cargando beneficiarios...</span>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredBeneficiarios.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? 'No se encontraron resultados' : 'No hay beneficiarios pendientes'}
            </h3>
            <p className="text-gray-500">
              {searchQuery
                ? 'Intenta ajustar los criterios de búsqueda'
                : '¡Excelente! Todos los beneficiarios completaron su perfil en /nuevo-usuario.'
              }
            </p>
          </div>
        )}

        {/* Beneficiarios Table */}
        {!loading && !error && filteredBeneficiarios.length > 0 && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Beneficiario
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Documento
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contacto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contrato
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Campaña
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fecha Registro
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBeneficiarios.map((beneficiario) => (
                    <tr key={beneficiario._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
                              <User className="h-5 w-5 text-orange-600" />
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {beneficiario.primerNombre} {beneficiario.segundoNombre || ''} {beneficiario.primerApellido} {beneficiario.segundoApellido || ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{beneficiario.numeroId}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{beneficiario.email || 'No especificado'}</div>
                        <div className="text-sm text-gray-500">{beneficiario.celular || beneficiario.telefono || 'No especificado'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{beneficiario.contrato || 'No especificado'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{beneficiario.campaign || 'No especificada'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(beneficiario._createdDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => handleSendWhatsApp(beneficiario)}
                          disabled={sendingWhatsApp === beneficiario._id || !beneficiario.celular || whatsAppSent.has(beneficiario._id)}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                            !beneficiario.celular
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : whatsAppSent.has(beneficiario._id)
                              ? 'bg-green-100 text-green-700 border border-green-300 cursor-not-allowed'
                              : sendingWhatsApp === beneficiario._id
                              ? 'bg-gray-100 text-gray-500'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                          title={
                            !beneficiario.celular
                              ? 'No hay número de celular registrado'
                              : whatsAppSent.has(beneficiario._id)
                              ? 'Mensaje ya enviado'
                              : 'Enviar mensaje de bienvenida por WhatsApp'
                          }
                        >
                          {sendingWhatsApp === beneficiario._id ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Enviando...</span>
                            </>
                          ) : whatsAppSent.has(beneficiario._id) ? (
                            <>
                              <MessageCircle className="w-4 h-4" />
                              <span>✓ Enviado</span>
                            </>
                          ) : (
                            <>
                              <MessageCircle className="w-4 h-4" />
                              <span>WhatsApp</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
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