'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { BanknotesIcon, CheckBadgeIcon, ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission, PersonPermission } from '@/types/permissions'
import { formatCurrency } from '@/lib/utils'
import { api, handleApiError } from '@/hooks/use-api'
import { usePermissions } from '@/hooks/usePermissions'
import { exportToExcel } from '@/lib/export-excel'

interface PagoRow {
  _id: string
  idPeople: string
  numCuota: number | null
  fechaPago: string | null
  fechaVencimiento: string | null
  valorPagado: number | null
  descuento: number | null
  saldo: number | null
  inscripcion: number | null
  validado: boolean
  fechaValidacion: string | null
  validadoPor: string | null
  numeroFactura: string | null
  gestorRecaudo: string | null
  medioPago: string | null
  titular_primerNombre: string
  titular_primerApellido: string
  titular_segundoApellido: string | null
  titular_numeroId: string
  titular_contrato: string | null
  titular_plataforma: string | null
}

interface DisplayUser {
  _id: string
  email: string
  nombre: string
  rol: string
}

const DISPLAY_ROLES = ['RECAUDO_ASIST', 'RECAUDOS_JEFE', 'COMERCIAL', 'SUPER_ADMIN', 'ADMIN']
const ROLE_LABEL: Record<string, string> = {
  RECAUDO_ASIST: 'Asistente',
  RECAUDOS_JEFE: 'Jefe',
  COMERCIAL: 'Comercial',
  SUPER_ADMIN: 'Admin',
  ADMIN: 'Admin',
}

const PAGE_SIZE = 50

function getLocalToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { timeZone: 'UTC' }) } catch { return '—' }
}

export default function GestionRecaudosPage() {
  const { hasPermission } = usePermissions()
  const canValidar = hasPermission(PersonPermission.PAGOS_VALIDAR)

  // Filtros (default estado=pendiente)
  const [estado, setEstado] = useState<'' | 'validado' | 'pendiente'>('pendiente')
  const [search, setSearch] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  // Datos
  const [pagos, setPagos] = useState<PagoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [displayUsers, setDisplayUsers] = useState<DisplayUser[]>([])

  // Modal validar
  const [validateModal, setValidateModal] = useState<{ id: string; numCuota: number | null; titular: string } | null>(null)
  const [facturaInput, setFacturaInput] = useState('')
  const [validating, setValidating] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchPagos = useCallback(async (resetPage = false) => {
    setLoading(true)
    try {
      const pageToUse = resetPage ? 1 : page
      const qs = new URLSearchParams()
      if (estado) qs.set('estado', estado)
      if (search.trim()) qs.set('search', search.trim())
      if (fechaInicio) qs.set('fechaInicio', fechaInicio)
      if (fechaFin) qs.set('fechaFin', fechaFin)
      qs.set('page', String(pageToUse))
      qs.set('pageSize', String(PAGE_SIZE))
      const data = await api.get<{ pagos: PagoRow[]; total: number; page: number }>(
        `/api/postgres/recaudos/pagos?${qs.toString()}`
      )
      setPagos(data.pagos || [])
      setTotal(data.total || 0)
      if (resetPage) setPage(1)
    } catch (err) {
      handleApiError(err, 'Error cargando pagos')
    } finally {
      setLoading(false)
    }
  }, [estado, search, fechaInicio, fechaFin, page])

  // Carga inicial
  useEffect(() => {
    api.get<{ users: DisplayUser[] }>(`/api/postgres/users/by-role?roles=${DISPLAY_ROLES.join(',')}&activeOnly=true`)
      .then(d => setDisplayUsers(d.users || []))
      .catch(() => {})
  }, [])

  // Refetch cuando cambia la página
  useEffect(() => { fetchPagos() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Carga inicial de pagos
  useEffect(() => { fetchPagos(true) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAplicarFiltros = () => fetchPagos(true)
  const handleLimpiar = () => {
    setEstado('pendiente'); setSearch(''); setFechaInicio(''); setFechaFin('')
    setTimeout(() => fetchPagos(true), 0)
  }

  const openValidar = (p: PagoRow) => {
    setFacturaInput('')
    setValidateModal({
      id: p._id,
      numCuota: p.numCuota,
      titular: `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim(),
    })
  }

  const handleValidar = async () => {
    if (!validateModal) return
    const factura = facturaInput.trim()
    if (!factura) { toast.error('Número de factura requerido'); return }
    setValidating(true)
    try {
      await api.post(`/api/postgres/pagos-titulares/${validateModal.id}/validar`, {
        numeroFactura: factura,
        fechaValidacion: getLocalToday(),
      })
      toast.success('Pago validado')
      setValidateModal(null)
      setFacturaInput('')
      // Refresca — si el filtro es 'pendiente', el pago validado desaparece
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error al validar pago')
    } finally {
      setValidating(false)
    }
  }

  const handleExport = () => {
    if (!pagos.length) { toast.error('No hay pagos para exportar'); return }
    const rows = pagos.map(p => {
      const gestor = displayUsers.find(u => u._id === p.gestorRecaudo)
        || displayUsers.find(u => u.email === p.gestorRecaudo)
      return {
        Titular: `${p.titular_primerNombre} ${p.titular_primerApellido} ${p.titular_segundoApellido ?? ''}`.trim(),
        'Número ID': p.titular_numeroId,
        Contrato: p.titular_contrato || '',
        'Cuota #': p.numCuota ?? '',
        'Fecha Pago': fmtDate(p.fechaPago),
        'Valor Pagado': p.valorPagado ?? 0,
        Descuento: p.descuento ?? 0,
        'Gestor Recaudo': gestor?.nombre || p.gestorRecaudo || '',
        Validado: p.validado ? 'Sí' : 'No',
        'Fecha Validación': fmtDate(p.fechaValidacion),
        'Validado por': p.validadoPor || '',
        '# Factura': p.numeroFactura || '',
        Plataforma: p.titular_plataforma || '',
      }
    })
    const columns = (Object.keys(rows[0]) as Array<keyof typeof rows[0]>).map(k => ({
      header: String(k),
      accessor: (row: typeof rows[0]) => row[k] as any,
    }))
    exportToExcel(rows, columns, `centro-validacion-pagos-${getLocalToday()}.csv`)
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.GESTION_VER} showDefaultMessage>
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <BanknotesIcon className="h-7 w-7 text-purple-600" />
                Centro de Validación de Pagos
              </h1>
              <p className="text-sm text-gray-500 mt-1">Pagos registrados pendientes de validación por recaudos.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={!pagos.length || loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> Exportar Excel
              </button>
              <button
                type="button"
                onClick={() => fetchPagos()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label htmlFor="search" className="block text-xs font-medium text-gray-700">Buscar (titular, ID, contrato)</label>
              <div className="mt-1 relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="search" type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAplicarFiltros() }}
                  placeholder="Apellido o nombre del titular..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="estado" className="block text-xs font-medium text-gray-700">Estado</label>
              <select
                id="estado" value={estado}
                onChange={e => setEstado(e.target.value as any)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Todos</option>
                <option value="pendiente">Pendientes</option>
                <option value="validado">Validados</option>
              </select>
            </div>
            <div>
              <label htmlFor="fechaInicio" className="block text-xs font-medium text-gray-700">Fecha desde</label>
              <input
                id="fechaInicio" type="date" value={fechaInicio}
                onChange={e => setFechaInicio(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="fechaFin" className="block text-xs font-medium text-gray-700">Fecha hasta</label>
              <input
                id="fechaFin" type="date" value={fechaFin}
                onChange={e => setFechaFin(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="md:col-span-5 flex items-center justify-end gap-2 pt-2">
              <button
                type="button" onClick={handleLimpiar}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Limpiar filtros
              </button>
              <button
                type="button" onClick={handleAplicarFiltros}
                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700"
              >
                Aplicar
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                Pagos {estado === 'pendiente' ? 'pendientes' : estado === 'validado' ? 'validados' : ''} ({total})
              </h3>
              <span className="text-xs text-gray-500">Página {page} de {totalPages}</span>
            </div>

            {loading ? (
              <p className="p-6 text-sm text-gray-400 italic text-center">Cargando…</p>
            ) : pagos.length === 0 ? (
              <p className="p-6 text-sm text-gray-400 italic text-center">No hay pagos con los filtros seleccionados</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Titular</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Pago</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Contrato</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700">Cuota #</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700">Valor Pagado</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Gestor Recaudo</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700">Validado</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Validación</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Validado por</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pagos.map(p => {
                      const gestor = displayUsers.find(u => u._id === p.gestorRecaudo)
                        || displayUsers.find(u => u.email === p.gestorRecaudo)
                      const titularNombre = `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim()
                      return (
                        <tr key={p._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <Link
                              href={`/person/${p.idPeople}?tab=financiera`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-medium"
                            >
                              {titularNombre || '—'}
                            </Link>
                            <div className="text-[11px] text-gray-500">ID {p.titular_numeroId}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-900">{fmtDate(p.fechaPago)}</td>
                          <td className="px-3 py-2 text-gray-700">{p.titular_contrato || '—'}</td>
                          <td className="px-3 py-2 text-center text-gray-900 font-medium">{p.numCuota ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-900 font-medium">{p.valorPagado ? formatCurrency(p.valorPagado) : '—'}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {gestor ? (
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">
                                  {ROLE_LABEL[gestor.rol] || gestor.rol}
                                </span>
                                <span className="text-xs">{gestor.nombre}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400 italic">{p.gestorRecaudo || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {p.validado ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <CheckBadgeIcon className="h-3.5 w-3.5" /> Sí
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                Pendiente
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-700 text-xs">{fmtDate(p.fechaValidacion)}</td>
                          <td className="px-3 py-2 text-gray-700 text-xs" title={p.validadoPor || ''}>
                            {p.validadoPor ? p.validadoPor.split('@')[0] : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!p.validado && canValidar && (
                              <button
                                type="button"
                                onClick={() => openValidar(p)}
                                title="Validar pago"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
                              >
                                <CheckBadgeIcon className="h-3.5 w-3.5" /> Validar
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginación */}
            {pagos.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
                <span className="text-gray-500 text-xs">
                  {((page - 1) * PAGE_SIZE) + 1} – {Math.min(page * PAGE_SIZE, total)} de {total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-gray-700">Página {page} de {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal validar */}
        {validateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">✅ Validar Pago</h3>
                <button onClick={() => setValidateModal(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-gray-600">
                Confirma la validación del pago{validateModal.numCuota != null ? ` (cuota ${validateModal.numCuota})` : ''}
                {' '}de <strong>{validateModal.titular}</strong>. Ingresa el <strong>número de factura</strong>; la fecha de validación quedará registrada como hoy.
              </p>
              <div>
                <label htmlFor="factura-input" className="block text-sm font-medium text-gray-700 mb-1">
                  # Factura <span className="text-red-500">*</span>
                </label>
                <input
                  id="factura-input"
                  type="text"
                  value={facturaInput}
                  onChange={e => setFacturaInput(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))}
                  autoFocus
                  placeholder="Alfanumérico"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ Una vez validado, el pago no se puede editar ni eliminar.
              </p>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setValidateModal(null); setFacturaInput('') }}
                  disabled={validating}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleValidar}
                  disabled={validating || !facturaInput.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {validating ? 'Validando…' : 'Validar Pago'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
