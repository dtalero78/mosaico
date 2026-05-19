'use client'

import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckBadgeIcon, TrashIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Person, FinancialData } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { PermissionGuard } from '@/components/permissions'
import { PersonPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { api, handleApiError } from '@/hooks/use-api'
import PagoTitularWizard from './PagoTitularWizard'

interface PersonFinancialProps {
  person: Person
  financialData?: FinancialData
}

interface RecaudoUser {
  _id: string
  email: string
  nombre: string
  rol: string
  activo: boolean
}

const GESTOR_ROLES = ['RECAUDO_ASIST', 'RECAUDOS_JEFE']
const ROLE_LABEL: Record<string, string> = {
  RECAUDO_ASIST: 'Asistente',
  RECAUDOS_JEFE: 'Jefe',
}

export default function PersonFinancial({ person, financialData }: PersonFinancialProps) {
  const isTitular = person.tipoUsuario === 'TITULAR'

  // Gestor de recaudo state
  const [gestorRecaudoId, setGestorRecaudoId] = useState<string | null>(person.gestorRecaudo ?? null)
  const [recaudoUsers, setRecaudoUsers] = useState<RecaudoUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Pagos del titular state
  const { hasPermission } = usePermissions()
  const canVerPagos = hasPermission(PersonPermission.PAGOS_VER)
  const [pagos, setPagos] = useState<any[]>([])
  const [loadingPagos, setLoadingPagos] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; nombre: string } | null>(null)

  const loadPagos = useCallback(async () => {
    if (!isTitular) return
    setLoadingPagos(true)
    try {
      const data = await api.get<{ pagos: any[] }>(`/api/postgres/pagos-titulares?idPeople=${person._id}`)
      setPagos(data.pagos || [])
    } catch (err) {
      console.warn('[PersonFinancial] No se pudieron cargar pagos:', err)
    } finally {
      setLoadingPagos(false)
    }
  }, [isTitular, person._id])

  useEffect(() => {
    if (isTitular && canVerPagos) loadPagos()
  }, [isTitular, canVerPagos, loadPagos])

  const handleValidarPago = async (id: string) => {
    try {
      await api.post(`/api/postgres/pagos-titulares/${id}/validar`, {})
      toast.success('Pago validado')
      loadPagos()
    } catch (err) {
      handleApiError(err, 'Error al validar pago')
    }
  }

  const handleDeletePago = async () => {
    if (!confirmDelete) return
    try {
      await api.delete(`/api/postgres/pagos-titulares/${confirmDelete.id}`)
      toast.success('Pago eliminado')
      setConfirmDelete(null)
      loadPagos()
    } catch (err) {
      handleApiError(err, 'Error al eliminar pago')
    }
  }

  const loadRecaudoUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const data = await api.get<{ users: RecaudoUser[] }>(
        `/api/postgres/users/by-role?roles=${GESTOR_ROLES.join(',')}&activeOnly=true`
      )
      setRecaudoUsers(data.users || [])
    } catch (err) {
      console.warn('[PersonFinancial] No se pudieron cargar usuarios de recaudo:', err)
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  // Load list once on mount (titulares only — otherwise the dropdown is irrelevant)
  useEffect(() => {
    if (isTitular) loadRecaudoUsers()
  }, [isTitular, loadRecaudoUsers])

  const currentGestor = recaudoUsers.find(u => u._id === gestorRecaudoId) || null

  const openAssignModal = () => {
    setSelectedUserId(gestorRecaudoId || '')
    setShowAssignModal(true)
  }

  const handleSaveGestor = async () => {
    setSaving(true)
    try {
      const payload = { gestorRecaudo: selectedUserId || null }
      await api.patch(`/api/postgres/people/${person._id}`, payload)
      setGestorRecaudoId(selectedUserId || null)
      setShowAssignModal(false)
      toast.success(selectedUserId ? 'Ejecutivo de Recaudos asignado' : 'Asignación removida')
    } catch (err) {
      handleApiError(err, 'Error al asignar gestor de recaudo')
    } finally {
      setSaving(false)
    }
  }

  // ── Financial data parsing (existing logic, unchanged) ──────────────────
  let financial: any
  let paymentProgress: number

  if (financialData) {
    const data = financialData as any
    const parseCurrency = (value: string | number) => {
      if (!value) return 0
      if (typeof value === 'number') return value
      const cleaned = value.replace(/\./g, '').replace(',', '.')
      return parseFloat(cleaned) || 0
    }
    const cuotaInicialParsed = parseCurrency(data.pagoInscripcion)
    financial = {
      contrato: data.contrato || person.contrato,
      tarifa: parseCurrency(data.valorCuota),
      cuotas: parseInt(data.numeroCuotas) || 0,
      saldo: parseCurrency(data.saldo),
      fechaUltimoPago: data.fechaPago || '',
      totalPlan: parseCurrency(data.totalPlan),
      cuotaInicial: cuotaInicialParsed,
      formaPago: data.medioPago || data.formaPago || 'No especificado',
      plan: data.plan || 'Plan estándar',
      inscripcionPagada: data.inscripcionPagada || 'No',
      confirmaJudith: data.confirmaJudith || 'No',
      confirmaPrixus: data.confirmaPrixus || 'No',
      montoTotal: parseCurrency(data.totalPlan),
      montoPendiente: parseCurrency(data.saldo),
      cuotasRestantes: data.valorCuota ? Math.ceil(parseCurrency(data.saldo) / parseCurrency(data.valorCuota)) : 0,
    }
    const montoPagado = financial.montoTotal - financial.montoPendiente
    paymentProgress = financial.montoTotal > 0 ? (montoPagado / financial.montoTotal) * 100 : 0
  } else {
    financial = {
      contrato: person.contrato, tarifa: 350000, cuotas: 12, cuotasPagadas: 8,
      saldo: 1400000, fechaUltimoPago: '2024-08-15', estado: 'Al día',
    }
    paymentProgress = (financial.cuotasPagadas / financial.cuotas) * 100
  }
  // Suppress unused warning — paymentProgress is computed for parity with original
  void paymentProgress

  return (
    <div className="space-y-6">
      {/* Financial Summary */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">💳 Resumen Financiero del Titular</h3>
          {isTitular && (
            <PermissionGuard permission={PersonPermission.ASIGNAR_GESTOR_RECAUDO}>
              <button
                type="button"
                onClick={openAssignModal}
                disabled={loadingUsers}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                💼 {currentGestor ? 'Reasignar Ejecutivo' : 'Asignar Ejecutivo de Recaudos'}
              </button>
            </PermissionGuard>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <div className="text-sm font-medium text-primary-600">Valor Plan</div>
            <div className="text-2xl font-bold text-primary-900">
              {financialData ? formatCurrency(financial.totalPlan) : 'No disponible'}
            </div>
          </div>
          <div className="bg-accent-50 border border-accent-200 rounded-lg p-4">
            <div className="text-sm font-medium text-accent-600">Cuota Inicial</div>
            <div className="text-2xl font-bold text-accent-900">
              {financialData ? formatCurrency(financial.cuotaInicial) : 'No disponible'}
            </div>
          </div>
          <div className="bg-warning-50 border border-warning-200 rounded-lg p-4">
            <div className="text-sm font-medium text-warning-600">Saldo</div>
            <div className="text-2xl font-bold text-warning-900">
              {financialData ? formatCurrency(financial.saldo) : 'No disponible'}
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-600">Cuotas Restantes</div>
            <div className="text-2xl font-bold text-blue-900">
              {financialData ? financial.cuotasRestantes : 'No disponible'}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Information */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">💰 Información de Pagos</h3>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          {/* Ejecutivo de Recaudos badge (only for TITULAR) */}
          {isTitular && (
            <div className="mb-4 pb-4 border-b border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-1">Ejecutivo de Recaudos</label>
              {loadingUsers && !currentGestor ? (
                <p className="text-sm text-gray-400 italic">Cargando…</p>
              ) : currentGestor ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                    {ROLE_LABEL[currentGestor.rol] || currentGestor.rol}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{currentGestor.nombre}</span>
                  <span className="text-xs text-gray-500">· {currentGestor.email}</span>
                </div>
              ) : (
                <p className="text-sm text-amber-700 italic">⚠️ Pendiente asignar Ejecutivo de Recaudos</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Método de Pago</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? financial.formaPago : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Plan Contratado</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? financial.plan : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Total del Plan</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? formatCurrency(financial.totalPlan) : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Inscripción Pagada</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? (financialData as any).inscripcionPagada || 'No especificado' : 'No disponible'}
              </p>
            </div>
          </div>

          {financialData && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Estado de Confirmaciones</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Confirmación Judith:</span>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    financial.confirmaJudith === 'Sí' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {financial.confirmaJudith || 'No'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Confirmación Prixus:</span>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    financial.confirmaPrixus === 'Sí' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {financial.confirmaPrixus || 'No'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Pagos del Titular ─────────────────────────────────────────────── */}
      {isTitular && (
        <PermissionGuard permission={PersonPermission.PAGOS_VER}>
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">📑 Pagos del Titular</h3>
              <PermissionGuard permission={PersonPermission.PAGOS_REGISTRAR}>
                <button
                  type="button"
                  onClick={() => setShowWizard(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  <PlusIcon className="h-4 w-4" /> Registrar Pago
                </button>
              </PermissionGuard>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {loadingPagos ? (
                <p className="p-6 text-sm text-gray-400 italic text-center">Cargando pagos…</p>
              ) : pagos.length === 0 ? (
                <p className="p-6 text-sm text-gray-400 italic text-center">No hay pagos registrados</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Cuota</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Valor Pagado</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Descuento</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Saldo</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Medio</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700"># Ref / Factura</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">Estado</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagos.map((p: any) => {
                        const fechaPago = p.fechaPago
                          ? new Date(p.fechaPago).toLocaleDateString('es', { timeZone: 'UTC' })
                          : '—'
                        return (
                          <tr key={p._id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-900">{fechaPago}</td>
                            <td className="px-3 py-2 text-gray-700">{p.numCuota ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-900 font-medium">{p.valorPagado ? formatCurrency(p.valorPagado) : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{p.descuento ? formatCurrency(p.descuento) : '—'}</td>
                            <td className="px-3 py-2 text-right text-amber-900 font-medium">{p.saldo != null ? formatCurrency(p.saldo) : '—'}</td>
                            <td className="px-3 py-2 text-gray-700">{p.medioPago || '—'}</td>
                            <td className="px-3 py-2 text-gray-700 text-xs">
                              {p.numeroReferencia ? <div>R: {p.numeroReferencia}</div> : null}
                              {p.numeroFactura ? <div>F: {p.numeroFactura}</div> : null}
                              {!p.numeroReferencia && !p.numeroFactura ? '—' : null}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {p.validado ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  <CheckBadgeIcon className="h-3.5 w-3.5" /> Validado
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                  Pendiente
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!p.validado && (
                                  <PermissionGuard permission={PersonPermission.PAGOS_VALIDAR}>
                                    <button
                                      type="button"
                                      onClick={() => handleValidarPago(p._id)}
                                      title="Validar pago"
                                      className="p-1 text-green-600 hover:text-green-800"
                                    >
                                      <CheckBadgeIcon className="h-4 w-4" />
                                    </button>
                                  </PermissionGuard>
                                )}
                                {!p.validado && (
                                  <PermissionGuard permission={PersonPermission.PAGOS_ELIMINAR}>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDelete({ id: p._id, nombre: `cuota ${p.numCuota ?? ''}` })}
                                      title="Eliminar pago"
                                      className="p-1 text-red-500 hover:text-red-700"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  </PermissionGuard>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </PermissionGuard>
      )}

      {/* ── Wizard Registrar Pago ──────────────────────────────────────────── */}
      {showWizard && (
        <PagoTitularWizard
          isOpen={showWizard}
          onClose={() => setShowWizard(false)}
          titular={{
            _id: person._id,
            numeroId: person.numeroId,
            plataforma: person.plataforma,
            gestorRecaudo: gestorRecaudoId,
            primerNombre: person.primerNombre,
            primerApellido: person.primerApellido,
          }}
          gestorLabel={currentGestor ? `${currentGestor.nombre} · ${ROLE_LABEL[currentGestor.rol] || currentGestor.rol}` : null}
          onCreated={loadPagos}
        />
      )}

      {/* ── Confirm Delete Pago ────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">⚠️ Eliminar Pago</h3>
            <p className="text-sm text-gray-600">
              ¿Confirmas eliminar este pago ({confirmDelete.nombre})? Esta acción es irreversible.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeletePago}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Asignar Ejecutivo de Recaudos ──────────────────────────── */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">💼 Asignar Ejecutivo de Recaudos</h3>
            <p className="text-sm text-gray-500">
              Selecciona un usuario con rol Recaudo (Asistente o Jefe). Solo se muestran usuarios activos.
            </p>

            <div>
              <label htmlFor="gestor-recaudo-select" className="block text-sm font-medium text-gray-700 mb-1">
                Ejecutivo
              </label>
              <select
                id="gestor-recaudo-select"
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                title="Selecciona el ejecutivo de recaudos a asignar"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">— Sin asignar —</option>
                {recaudoUsers.map(u => (
                  <option key={u._id} value={u._id}>
                    {u.nombre} · {ROLE_LABEL[u.rol] || u.rol}
                  </option>
                ))}
              </select>
              {recaudoUsers.length === 0 && !loadingUsers && (
                <p className="text-xs text-amber-700 mt-1">No hay usuarios activos con rol Recaudo</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveGestor}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
