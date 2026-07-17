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
import { usePermissions } from '@/hooks/usePermissions'

// Tipos
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
  tipoUsuario: string
  aprobacion?: string
  hashConsentimiento?: string
  documentacion?: string[]
  _createdDate: Date
  fechaProximaGestion?: Date
}

interface FilterState {
  estado: string
  campaign: string
  fechaInicio: Date | null
  fechaFin: Date | null
}

const ESTADOS_APROBACION = [
  { value: '', label: 'Todos los contratos' },
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
    campaign: '',
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

  // ── Autoaprobar (casillas por fila + botón único para los marcados) ──
  // hasPermission ya bypassa SUPER_ADMIN/ADMIN.
  const { hasPermission } = usePermissions()
  const canAutoaprobar = hasPermission(AprobacionPermission.AUTOAPROBAR)
  // Intención por fila: { auto, welcome }. WELCOME no puede ir sin auto.
  const [rowIntent, setRowIntent] = useState<Record<string, { auto: boolean; welcome: boolean }>>({})
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const [bulkResults, setBulkResults] = useState<Array<{ nombre: string; contrato: string; ok: boolean; detalle: string }> | null>(null)
  const [autoMsg, setAutoMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const setIntent = (id: string, patch: Partial<{ auto: boolean; welcome: boolean }>) => {
    setRowIntent(prev => {
      const cur = prev[id] || { auto: false, welcome: false }
      const next = { ...cur, ...patch }
      // WELCOME jamás queda marcado sin auto.
      if (!next.auto) next.welcome = false
      return { ...prev, [id]: next }
    })
  }

  // Contratos marcados (auto=true) que siguen pendientes. Incluye los marcados aunque
  // un cambio de filtro los haya sacado de la página actual — el modal los lista todos.
  const marcados = allContratos.filter(c => rowIntent[c._id]?.auto)

  const aplicarMarcados = async () => {
    setBulkBusy(true)
    setBulkResults(null)
    setAutoMsg(null)
    const targets = marcados
    const results: Array<{ id: string; nombre: string; contrato: string; ok: boolean; detalle: string }> = []
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ done: i, total: targets.length })
      const c = targets[i]
      const promoverWelcome = rowIntent[c._id]?.welcome || false
      const nombre = `${c.primerNombre} ${c.primerApellido}`
      try {
        const res = await fetch(`/api/postgres/approvals/${c._id}/autoaprobar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ promoverWelcome }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json?.success === false) throw new Error(json?.error || `Error ${res.status}`)
        const promo = promoverWelcome ? `, WELCOME +${json.welcomePromovidos ?? 0}` : ''
        const pdf = json.pdfArchivado ? ', contrato archivado' : `, ⚠ contrato no archivado`
        results.push({ id: c._id, nombre, contrato: c.contrato, ok: true, detalle: `benef ${json.beneficiariosAprobados ?? 0}${promo}${pdf}` })
      } catch (err: any) {
        results.push({ id: c._id, nombre, contrato: c.contrato, ok: false, detalle: err.message })
      }
    }
    setBulkProgress({ done: targets.length, total: targets.length })

    // Los aprobados con éxito salen de la lista de pendientes.
    const okIds = new Set(results.filter(r => r.ok).map(r => r.id))
    if (okIds.size) {
      setAllContratos(prev => prev.filter(c => !okIds.has(c._id)))
      setContratos(prev => prev.filter(c => !okIds.has(c._id)))
      setRowIntent(prev => { const n = { ...prev }; okIds.forEach(id => delete n[id]); return n })
    }
    const ok = results.filter(r => r.ok).length
    const fail = results.length - ok
    setAutoMsg({
      text: fail === 0
        ? `✅ ${ok} contrato(s) autoaprobado(s)`
        : `⚠ ${ok} autoaprobado(s), ${fail} con error`,
      ok: fail === 0,
    })
    setBulkResults(results.map(({ nombre, contrato, ok, detalle }) => ({ nombre, contrato, ok, detalle })))
    setBulkBusy(false)
  }

  const cerrarBulk = () => {
    setShowBulkModal(false)
    setBulkResults(null)
    setBulkProgress(null)
  }

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
          // NO paginar los datos crudos: el filtro por defecto ("Firmado sin
          // aprobar") se aplica en el useEffect que depende de allContratos.
          // Paginar aquí mostraba TODOS los registros (incluidos "Sin firmar")
          // hasta que el usuario tocara un filtro.
          setAllContratos(result.approvals)
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

    // Filtrar por campaña
    if (filters.campaign) {
      data = data.filter(c => (c.campaign || '') === filters.campaign)
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

  // Aplicar filtros automáticamente cuando cambian los filtros, la búsqueda o
  // cuando terminan de llegar los datos (allContratos). Sin `allContratos` en las
  // dependencias, el filtro por defecto NO se aplicaba al cargar la página.
  useEffect(() => {
    if (allContratos.length > 0) {
      const filtered = getFilteredData()
      updatePagination(filtered)
    }
  }, [allContratos, searchApellido, filters.estado, filters.campaign, filters.fechaInicio, filters.fechaFin])

  // Campañas disponibles (para el dropdown)
  const campaignOptions = Array.from(new Set(allContratos.map(c => c.campaign).filter(Boolean))).sort() as string[]

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
      <PermissionGuard anyPermissions={[AprobacionPermission.CENTRO_VER, AprobacionPermission.ACTUALIZAR]}>
        <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">🛡️ Gestión de Aprobaciones</h1>
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
                { header: 'Campaña', accessor: (c) => c.campaign || '' },
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
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
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
            <div className="lg:col-span-3">
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
            <div className="lg:col-span-2">
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

            {/* Filtro de campaña */}
            <div className="lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Campaña
              </label>
              <select
                value={filters.campaign}
                onChange={(e) => setFilters(prev => ({ ...prev, campaign: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Todas</option>
                {campaignOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Rango de fechas */}
            <div className="lg:col-span-4">
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

        {/* Banner de resultado de autoaprobación */}
        {autoMsg && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium flex items-center justify-between ${
            autoMsg.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            <span>{autoMsg.text}</span>
            <button onClick={() => setAutoMsg(null)} className="ml-4 text-current opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Información de resultados */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {searchApellido || filters.estado || filters.campaign || filters.fechaInicio || filters.fechaFin
                ? `Registros filtrados (${getFilteredData().length})`
                : `Registros pendientes de aprobación (${allContratos.length})`
              }
            </h2>
            {/* Botón único: aplica el autoaprobar a todas las filas marcadas */}
            {canAutoaprobar && marcados.length > 0 && (
              <button
                type="button"
                onClick={() => { setBulkResults(null); setBulkProgress(null); setAutoMsg(null); setShowBulkModal(true) }}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
              >
                <CheckCircle className="w-4 h-4" />
                Aplicar a marcados ({marcados.length})
              </button>
            )}
          </div>

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
                      Campaña
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
                    {canAutoaprobar && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Acciones
                      </th>
                    )}
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
                          {(contrato as any).extemporanea && (
                            <span className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                              ⏰ Extemporánea
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{contrato.campaign || '—'}</div>
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
                        {canAutoaprobar && (
                          <td className="px-6 py-4 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-1.5">
                              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                                  checked={rowIntent[contrato._id]?.auto || false}
                                  onChange={e => setIntent(contrato._id, { auto: e.target.checked })}
                                />
                                Autoaprobar
                              </label>
                              <label
                                className={`inline-flex items-center gap-2 text-sm cursor-pointer ${
                                  rowIntent[contrato._id]?.auto ? 'text-gray-700' : 'text-gray-300 cursor-not-allowed'
                                }`}
                                title={rowIntent[contrato._id]?.auto ? '' : 'Requiere marcar Autoaprobar'}
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 disabled:opacity-40"
                                  disabled={!rowIntent[contrato._id]?.auto}
                                  checked={rowIntent[contrato._id]?.welcome || false}
                                  onChange={e => setIntent(contrato._id, { welcome: e.target.checked })}
                                />
                                Promover WELCOME
                              </label>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal de confirmación — Autoaprobar en lote (los marcados) */}
        {showBulkModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-xl w-full max-h-[85vh] flex flex-col">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {bulkResults ? 'Resultado' : `Autoaprobar ${marcados.length} contrato(s)`}
              </h3>

              {/* Antes de procesar: advertencia + lista de marcados */}
              {!bulkResults && !bulkBusy && (
                <>
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 mb-3">
                    Cada contrato se <strong>aprueba</strong> (titular + beneficiarios, activa y genera
                    agendamientos), se <strong>registra el consentimiento como automático</strong> y se
                    <strong> genera/archiva el contrato en Drive</strong>, sin WhatsApp. Los marcados con
                    <strong> WELCOME</strong> además promueven a sus beneficiarios al curso real. Es
                    <strong> irreversible</strong> y queda auditado.
                  </div>
                  <div className="overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100 mb-4">
                    {marcados.map(c => (
                      <div key={c._id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="text-gray-800">
                          {c.primerNombre} {c.primerApellido}
                          <span className="text-gray-400"> · {c.contrato}</span>
                        </span>
                        {rowIntent[c._id]?.welcome && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-700">
                            + WELCOME
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Durante el proceso: barra de progreso */}
              {bulkBusy && bulkProgress && (
                <div className="py-6">
                  <p className="text-sm text-gray-600 mb-2">Procesando {bulkProgress.done} / {bulkProgress.total}…</p>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-primary-600 transition-all"
                      style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Cada contrato genera su PDF; puede tardar unos segundos por fila.</p>
                </div>
              )}

              {/* Al terminar: resumen por contrato */}
              {bulkResults && (
                <div className="overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100 mb-4">
                  {bulkResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <span className={r.ok ? 'text-green-600' : 'text-red-600'}>{r.ok ? '✓' : '✗'}</span>
                      <span className="text-gray-800 flex-1">
                        {r.nombre} <span className="text-gray-400">· {r.contrato}</span>
                        <span className="block text-xs text-gray-500">{r.detalle}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-auto">
                {!bulkResults ? (
                  <>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={cerrarBulk}
                      className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={bulkBusy || marcados.length === 0}
                      onClick={aplicarMarcados}
                      className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60"
                    >
                      {bulkBusy ? 'Aplicando…' : `Autoaprobar ${marcados.length}`}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={cerrarBulk}
                    className="px-4 py-2 text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
                  >
                    Cerrar
                  </button>
                )}
              </div>
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