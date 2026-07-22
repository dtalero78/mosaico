'use client'

import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { CheckBadgeIcon, TrashIcon, PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
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
// Roles que pueden aparecer en PAGOS_TITULARES.gestorRecaudo (cuota#0 = comercial; resto = recaudo)
const DISPLAY_ROLES = ['RECAUDO_ASIST', 'RECAUDOS_JEFE', 'COMERCIAL', 'SUPER_ADMIN', 'ADMIN']
const ROLE_LABEL: Record<string, string> = {
  RECAUDO_ASIST: 'Asistente',
  RECAUDOS_JEFE: 'Jefe',
  COMERCIAL: 'Comercial',
  SUPER_ADMIN: 'Admin',
  ADMIN: 'Admin',
}

export default function PersonFinancial({ person, financialData }: PersonFinancialProps) {
  const isTitular = person.tipoUsuario === 'TITULAR'

  // Gestor de recaudo state
  const [gestorRecaudoId, setGestorRecaudoId] = useState<string | null>(person.gestorRecaudo ?? null)
  // Marca manual "Opcional" — alimenta columna Opcional de /dashboard/recaudos/asignacion
  const [marcaOpcional, setMarcaOpcional] = useState<string | null>((person as any).marcaOpcional ?? null)
  const [togglingOpcional, setTogglingOpcional] = useState(false)
  /** Sólo usuarios con rol RECAUDO_* (poblar dropdown del modal Asignar Ejecutivo) */
  const [recaudoUsers, setRecaudoUsers] = useState<RecaudoUser[]>([])
  /** Lista ampliada (incluye COMERCIAL/ADMIN) para resolver el _id de cualquier
   *  gestorRecaudo guardado en PAGOS_TITULARES.gestorRecaudo (cuota#0 = comercial) */
  const [displayUsers, setDisplayUsers] = useState<RecaudoUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Pagos del titular state
  const { hasPermission, isRole } = usePermissions()
  const canVerPagos = hasPermission(PersonPermission.PAGOS_VER)
  // SuperAdmin/Admin ve siempre las acciones (incluso sobre pagos validados),
  // resto de roles solo ve acciones sobre pagos pendientes.
  const isAdmin = isRole('SUPER_ADMIN' as any) || isRole('ADMIN' as any)
  // RECAUDO_ASIST: rol operativo de captura — sólo registra pagos e imprime
  // recibos. No valida (lo hace el JEFE / financiero) ni elimina pagos.
  const isRecaudoAsist = isRole('RECAUDO_ASIST' as any)
  const [pagos, setPagos] = useState<any[]>([])
  const [loadingPagos, setLoadingPagos] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; nombre: string } | null>(null)
  const [validateModal, setValidateModal] = useState<{ id: string; numCuota: number | null } | null>(null)
  const [facturaInput, setFacturaInput] = useState('')
  const [validating, setValidating] = useState(false)

  // Cambio Estado Cartera modal state
  const [showCarteraModal, setShowCarteraModal] = useState(false)
  const [carteraNuevoTipo, setCarteraNuevoTipo] = useState<string>('')
  const [carteraMotivo, setCarteraMotivo] = useState('')
  const [carteraConfirm, setCarteraConfirm] = useState(false)
  const [savingCartera, setSavingCartera] = useState(false)

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

  const openValidarModal = (id: string, numCuota: number | null) => {
    setFacturaInput('')
    setValidateModal({ id, numCuota })
  }

  // YYYY-MM-DD en TZ local del navegador (evita corrimiento UTC al guardar fechas)
  const getLocalToday = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const handleValidarPago = async () => {
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
      loadPagos()
    } catch (err) {
      handleApiError(err, 'Error al validar pago')
    } finally {
      setValidating(false)
    }
  }

  const handleGenerarRecibo = async (id: string) => {
    const tid = toast.loading('Generando recibo…')
    try {
      const data = await api.post<{ pdfUrl: string; numeroRecibo: string }>(
        `/api/postgres/pagos-titulares/${id}/recibo`, {}
      )
      toast.success(`Recibo ${data.numeroRecibo} generado`, { id: tid })
      if (data.pdfUrl) window.open(data.pdfUrl, '_blank', 'noopener,noreferrer')
      loadPagos()
    } catch (err) {
      toast.dismiss(tid)
      handleApiError(err, 'Error generando recibo')
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
      // Carga ampliada (recaudo + comercial + admin) — para resolver nombre del gestor en cada pago
      const data = await api.get<{ users: RecaudoUser[] }>(
        `/api/postgres/users/by-role?roles=${DISPLAY_ROLES.join(',')}&activeOnly=true`
      )
      const allUsers = data.users || []
      setDisplayUsers(allUsers)
      // Subset para el dropdown de Asignar Ejecutivo (sólo roles de Recaudo)
      setRecaudoUsers(allUsers.filter(u => GESTOR_ROLES.includes(u.rol)))
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

  // ─── Cambio Estado Cartera ─────────────────────────────────────────────
  const openCarteraModal = () => {
    setCarteraNuevoTipo('')
    setCarteraMotivo('')
    setCarteraConfirm(false)
    setShowCarteraModal(true)
  }

  /** Toggle de la marca "Opcional" (PEOPLE.marcaOpcional). Sin modal, sin
   *  motivo — es una marca operativa simple del área de Recaudo. */
  const handleToggleOpcional = async () => {
    setTogglingOpcional(true)
    try {
      const data = await api.post<{ marcaOpcional: string | null }>(
        `/api/postgres/people/${person._id}/marca-opcional`,
        {},
      )
      setMarcaOpcional(data.marcaOpcional ?? null)
      toast.success(data.marcaOpcional === 'OPC' ? 'Marcado como OPC' : 'Marca OPC removida')
    } catch (err) {
      handleApiError(err, 'Error al cambiar marca Opcional')
    } finally {
      setTogglingOpcional(false)
    }
  }

  const handleCambiarCartera = async () => {
    if (!carteraNuevoTipo || !carteraMotivo.trim() || !carteraConfirm) return
    setSavingCartera(true)
    try {
      await api.post(`/api/postgres/people/${person._id}/cambio-cartera`, {
        nuevoTipo: carteraNuevoTipo,
        motivo: carteraMotivo.trim(),
      })
      toast.success('Estado de cartera actualizado')
      setShowCarteraModal(false)
      loadPagos()   // recarga para refrescar el badge desde cuota#0
    } catch (err) {
      handleApiError(err, 'Error al cambiar estado de cartera')
    } finally {
      setSavingCartera(false)
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
    const numeroCuotas = parseInt(data.numeroCuotas) || 0
    const cuotasPagadas = parseInt(data.cuotasPagadas) || 0
    financial = {
      contrato: data.contrato || person.contrato,
      tarifa: parseCurrency(data.valorCuota),
      cuotas: numeroCuotas,
      cuotasPagadas,
      saldo: parseCurrency(data.saldo),
      fechaUltimoPago: data.fechaPago || '',
      totalPlan: parseCurrency(data.totalPlan),
      cuotaInicial: cuotaInicialParsed,
      formaPago: data.medioPago || data.formaPago || 'No especificado',
      // PEOPLE.plan es la fuente más confiable (los 2,033 titulares canónicos viven ahí).
      // FINANCIEROS.plan solo está poblado en ~34 contratos por desajuste legacy con
      // PEOPLE.contrato. Damos prioridad a person.plan y caemos a FINANCIEROS si falta.
      plan: (person as any)?.plan || data.plan || 'No disponible',
      inscripcionPagada: data.inscripcionPagada || 'No',
      montoTotal: parseCurrency(data.totalPlan),
      montoPendiente: parseCurrency(data.saldo),
      // Cuotas restantes = total de cuotas del contrato − cuotas validadas
      // (FINANCIEROS.cuotasPagadas se mantiene al día por syncFinancieroSaldo)
      cuotasRestantes: Math.max(0, numeroCuotas - cuotasPagadas),
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

  // PEOPLE.plan tiene prioridad sobre FINANCIEROS.plan (más confiable).
  // Se aplica POST if/else para cubrir también el caso sin financialData
  // (titulares sin fila en FINANCIEROS — caso TIARE NUÑEZ y similares).
  financial.plan = (person as any)?.plan || financial.plan || 'No disponible'

  // ── Derivados del listado de pagos para mostrar en "Información de Pagos" ──
  // Cuotas pagadas REALES = pagos validados con numCuota > 0
  // (la cuota #0 = inscripción NO cuenta como cuota pagada)
  const cuotasPagadasReales = pagos
    .filter((p: any) => p.validado === true && Number(p.numCuota) > 0)
    .length
  // Estado Cartera: leído del registro cuota #0 (donde se guarda el tipo de
  // cartera del contrato). Default 'normal' si no hay cuota #0.
  const cuotaCero: any = pagos.find((p: any) => Number(p.numCuota) === 0)
  const estadoCartera = String(cuotaCero?.tipoCartera || 'normal').toLowerCase()
  // Vocabulario canónico (mayo 2026): Normal/Prejuridico/UltimoPago/Penalidad.
  // Legacy: juridico/castigada se mantienen para lectura de datos históricos.
  const ESTADO_CARTERA_META: Record<string, { label: string; cls: string }> = {
    normal:      { label: 'Normal',       cls: 'bg-green-100 text-green-800' },
    prejuridico: { label: 'Prejurídico',  cls: 'bg-red-100 text-red-800' },
    ultimopago:  { label: 'Último Pago',  cls: 'bg-purple-100 text-purple-800' },
    penalidad:   { label: 'Penalidad',    cls: 'bg-orange-100 text-orange-800' },
    // Legacy — sólo render
    juridico:    { label: 'Jurídico (legacy)',   cls: 'bg-gray-200 text-gray-700' },
    castigada:   { label: 'Castigada (legacy)',  cls: 'bg-gray-200 text-gray-700' },
  }
  const estadoMeta = ESTADO_CARTERA_META[estadoCartera] || { label: estadoCartera, cls: 'bg-gray-100 text-gray-800' }

  return (
    <div className="space-y-6">
      {/* Financial Summary — gateado por PERSON.FINANCIERA.RESUMEN_VER */}
      <PermissionGuard permission={PersonPermission.RESUMEN_FINANCIERO_VER}>
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-medium text-gray-900">💳 Resumen Financiero del Titular</h3>
          {isTitular && (
            <div className="flex items-center gap-2 flex-wrap">
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
              <PermissionGuard permission={PersonPermission.CAMBIO_ESTADO_CARTERA}>
                <button
                  type="button"
                  onClick={openCarteraModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-md hover:bg-orange-700"
                >
                  🔄 Cambio Estado Cartera
                </button>
              </PermissionGuard>
              <PermissionGuard permission={PersonPermission.MARCAR_OPCIONAL}>
                <button
                  type="button"
                  onClick={handleToggleOpcional}
                  disabled={togglingOpcional}
                  title={marcaOpcional === 'OPC'
                    ? 'Quitar marca OPC (toggle)'
                    : 'Marcar como OPC para destacar en /dashboard/recaudos/asignacion'}
                  className={
                    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md disabled:opacity-50 ` +
                    (marcaOpcional === 'OPC'
                      ? 'bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-200'
                      : 'bg-white text-orange-700 border border-orange-300 hover:bg-orange-50')
                  }
                >
                  {marcaOpcional === 'OPC' ? '✓ Opcional (OPC)' : 'Opcional'}
                </button>
              </PermissionGuard>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Valor Plan — total contractual del programa */}
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <div className="text-sm font-medium text-primary-600">Valor Plan</div>
            <div className="text-2xl font-bold text-primary-900">
              {financialData ? formatCurrency(financial.totalPlan) : 'No disponible'}
            </div>
          </div>
          {/* Inscripción — valor pagado al firmar (cuota #0) */}
          <div className="bg-accent-50 border border-accent-200 rounded-lg p-4">
            <div className="text-sm font-medium text-accent-600">Inscripción</div>
            <div className="text-2xl font-bold text-accent-900">
              {financialData ? formatCurrency(financial.cuotaInicial) : 'No disponible'}
            </div>
          </div>
          {/* Saldo a la Firma — congelado: totalPlan − inscripción */}
          <div className="bg-warning-50 border border-warning-200 rounded-lg p-4">
            <div className="text-sm font-medium text-warning-600">Saldo a la Firma</div>
            <div className="text-2xl font-bold text-warning-900">
              {financialData
                ? formatCurrency(Math.max(0, (financial.totalPlan || 0) - (financial.cuotaInicial || 0)))
                : 'No disponible'}
            </div>
          </div>
          {/* Total Cuotas — número de cuotas pactado en el contrato */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-sm font-medium text-blue-600">Total Cuotas</div>
            <div className="text-2xl font-bold text-blue-900">
              {financialData ? (financial.cuotas || 0) : 'No disponible'}
            </div>
          </div>
          {/* Saldo a la Fecha — calculado: lo que queda debiendo HOY (FINANCIEROS.saldo,
              mantenido al día por syncFinancieroSaldo desde los pagos validados) */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-sm font-medium text-emerald-600">Saldo a la Fecha</div>
            <div className="text-2xl font-bold text-emerald-900">
              {financialData ? formatCurrency(financial.saldo) : 'No disponible'}
            </div>
          </div>
        </div>
      </div>
      </PermissionGuard>

      {/* Payment Information — gateado por PERSON.FINANCIERA.INFO_PAGOS_VER */}
      <PermissionGuard permission={PersonPermission.INFO_PAGOS_VER}>
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Método de Pago</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? financial.formaPago : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Tipo de Plan</label>
              <p className="mt-1 text-sm text-gray-900">
                {financialData ? financial.plan : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cuotas Pagadas</label>
              <p className="mt-1 text-sm text-gray-900 font-semibold">
                {cuotasPagadasReales}{financial.cuotas ? ` / ${financial.cuotas}` : ''}
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
                {financialData && financial.cuotaInicial > 0
                  ? formatCurrency(financial.cuotaInicial)
                  : 'No disponible'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Valor Cuota</label>
              <p className="mt-1 text-sm text-gray-900 font-semibold">
                {financialData && financial.tarifa > 0
                  ? formatCurrency(financial.tarifa)
                  : 'No disponible'}
              </p>
            </div>
            <div className="md:col-span-3 pt-3 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado Cartera</label>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${estadoMeta.cls}`}>
                {estadoMeta.label}
              </span>
            </div>
          </div>

        </div>
      </div>
      </PermissionGuard>

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
                        <th className="px-3 py-2 text-center font-medium text-gray-700"># Cuota</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Gestor</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Valor Pagado</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Descuento</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Saldo</th>
                        <th className="px-3 py-2 text-center font-medium text-gray-700">Validado</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Validación</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700">Validado por</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-700"># Factura</th>
                        <th className="px-3 py-2 text-right font-medium text-gray-700">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        // Running balance por fila — saldo del contrato DESPUÉS
                        // de aplicar los pagos VALIDADOS hasta esta fila inclusive
                        // (orden cronológico por fechaPago + _createdDate).
                        // Coincide con la lógica de syncFinancieroSaldo (Opción 2).
                        const runningMap = new Map<string, number>()
                        if (financial?.totalPlan) {
                          const asc = [...pagos].sort((a: any, b: any) => {
                            const da = (a.fechaPago || '').slice(0, 10) + (a._createdDate || '')
                            const db = (b.fechaPago || '').slice(0, 10) + (b._createdDate || '')
                            return da.localeCompare(db)
                          })
                          let running = Number(financial.totalPlan) || 0
                          for (const pp of asc) {
                            if (pp.validado) {
                              const paid = (Number(pp.valorPagado) || 0) + (Number(pp.descuento) || 0)
                              running = Math.max(0, running - paid)
                            }
                            runningMap.set(pp._id, running)
                          }
                        }
                        return pagos.map((p: any) => {
                        const fechaPago = p.fechaPago
                          ? new Date(p.fechaPago).toLocaleDateString('es', { timeZone: 'UTC' })
                          : '—'
                        const fechaValidacion = p.fechaValidacion
                          ? new Date(p.fechaValidacion).toLocaleDateString('es', { timeZone: 'UTC' })
                          : '—'
                        // PAGOS_TITULARES.gestorRecaudo puede ser _id de USUARIOS_ROLES
                        // (comercial en cuota#0, recaudo en otras) o un email crudo de fallback
                        const gestor = displayUsers.find(u => u._id === p.gestorRecaudo)
                          || displayUsers.find(u => u.email === p.gestorRecaudo)
                        const gestorLabel = gestor ? gestor.nombre : (p.gestorRecaudo || '—')
                        // Saldo a mostrar: running balance si fue calculado (validado),
                        // sino conserva el saldo per-cuota almacenado para pagos pendientes
                        const saldoDisplay = runningMap.has(p._id)
                          ? runningMap.get(p._id)!
                          : (p.saldo != null ? Number(p.saldo) : null)
                        return (
                          <tr key={p._id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-center text-gray-900 font-medium">{p.numCuota ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-900">{fechaPago}</td>
                            <td className="px-3 py-2 text-gray-700">
                              {gestor ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">
                                    {ROLE_LABEL[gestor.rol] || gestor.rol}
                                  </span>
                                  <span className="text-xs">{gestor.nombre}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400 italic">{gestorLabel}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-gray-900 font-medium">{p.valorPagado ? formatCurrency(p.valorPagado) : '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{p.descuento ? formatCurrency(p.descuento) : '—'}</td>
                            <td className="px-3 py-2 text-right text-amber-900 font-medium">{saldoDisplay != null ? formatCurrency(saldoDisplay) : '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {p.validado ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  <CheckBadgeIcon className="h-3.5 w-3.5" /> Sí
                                </span>
                              ) : (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                  No
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-700 text-xs">{fechaValidacion}</td>
                            <td className="px-3 py-2 text-gray-700 text-xs" title={p.validadoPor || ''}>
                              {p.validadoPor ? p.validadoPor.split('@')[0] : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-700 text-xs">{p.numeroFactura || '—'}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Recibo: disponible apenas se registra el pago (NO requiere validado).
                                    Para RECAUDO_ASIST ésta es la única acción visible. */}
                                <PermissionGuard permission={PersonPermission.PAGOS_RECIBO}>
                                  <button
                                    type="button"
                                    onClick={() => handleGenerarRecibo(p._id)}
                                    title={p.numeroRecibo ? `Descargar recibo ${p.numeroRecibo}` : 'Generar recibo de pago'}
                                    className="p-1 text-indigo-600 hover:text-indigo-800"
                                  >
                                    <DocumentTextIcon className="h-4 w-4" />
                                  </button>
                                </PermissionGuard>
                                {/* Validar: visible si no está validado (cualquier rol con permiso),
                                    EXCEPTO RECAUDO_ASIST que sólo registra/imprime — la validación
                                    contable es responsabilidad del jefe/financiero. */}
                                {!p.validado && !isRecaudoAsist && (
                                  <PermissionGuard permission={PersonPermission.PAGOS_VALIDAR}>
                                    <button
                                      type="button"
                                      onClick={() => openValidarModal(p._id, p.numCuota ?? null)}
                                      title="Validar pago"
                                      className="p-1 text-green-600 hover:text-green-800"
                                    >
                                      <CheckBadgeIcon className="h-4 w-4" />
                                    </button>
                                  </PermissionGuard>
                                )}
                                {/* Eliminar: visible para pagos pendientes (cualquier rol con permiso)
                                    o siempre para SuperAdmin/Admin (pueden borrar validados también).
                                    RECAUDO_ASIST nunca puede borrar, ni siquiera pagos pendientes que
                                    él mismo registró. */}
                                {(!p.validado || isAdmin) && !isRecaudoAsist && (
                                  <PermissionGuard permission={PersonPermission.PAGOS_ELIMINAR}>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDelete({ id: p._id, nombre: `cuota ${p.numCuota ?? ''}${p.validado ? ' (validado)' : ''}` })}
                                      title={p.validado ? 'Eliminar pago validado (acción de admin)' : 'Eliminar pago'}
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
                      })
                      })()}
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
          existingPagos={pagos}
          // "Saldo a la Fecha" del wizard = FINANCIEROS.saldo dinámico
          // (lo que queda debiendo HOY, ya mantenido por syncFinancieroSaldo).
          // El wizard lo usa para mostrar el campo read-only y computar
          // "Saldo después de pago" en vivo.
          saldoActual={Number(financial?.saldo ?? 0)}
          onCreated={loadPagos}
        />
      )}

      {/* ── Validar Pago (captura # Factura) ───────────────────────────────── */}
      {validateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">✅ Validar Pago</h3>
            <p className="text-sm text-gray-600">
              Confirma la validación del pago{validateModal.numCuota != null ? ` (cuota ${validateModal.numCuota})` : ''}.
              Ingresa el <strong>número de factura</strong>; la fecha de validación quedará registrada como hoy.
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
                onClick={handleValidarPago}
                disabled={validating || !facturaInput.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {validating ? 'Validando…' : 'Validar Pago'}
              </button>
            </div>
          </div>
        </div>
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

      {/* ── Modal Cambio Estado Cartera ──────────────────────────────────── */}
      {showCarteraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">🔄 Cambio Estado Cartera</h3>

            {/* Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
              ⚠️ Esta acción cambia el tipo de cartera del titular y queda registrada
              en el log de auditoría con tu usuario, fecha y motivo. <strong>El cambio es
              inmediato</strong> — afecta visualización en /dashboard/recaudos y reportes.
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1">Estado actual</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${estadoMeta.cls}`}>
                {estadoMeta.label}
              </span>
            </div>

            <div>
              <label htmlFor="cartera-nuevo-tipo" className="block text-sm font-medium text-gray-700 mb-1">
                Nuevo Estado <span className="text-red-500">*</span>
              </label>
              <select
                id="cartera-nuevo-tipo"
                value={carteraNuevoTipo}
                onChange={e => setCarteraNuevoTipo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">— Selecciona —</option>
                <option value="normal">Normal</option>
                <option value="prejuridico">Prejurídico</option>
                <option value="ultimopago">Último Pago</option>
                <option value="penalidad">Penalidad</option>
              </select>
            </div>

            <div>
              <label htmlFor="cartera-motivo" className="block text-sm font-medium text-gray-700 mb-1">
                Motivo <span className="text-red-500">*</span>
              </label>
              <textarea
                id="cartera-motivo"
                rows={3}
                value={carteraMotivo}
                onChange={e => setCarteraMotivo(e.target.value)}
                placeholder="Ej: titular no atiende llamadas hace 30 días — escalar a Prejurídico"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                El motivo queda guardado en el log de auditoría y no se puede editar después.
              </p>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={carteraConfirm}
                onChange={e => setCarteraConfirm(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-sm text-gray-800">
                Confirmo el cambio de estado de cartera para este titular
              </span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCarteraModal(false)}
                disabled={savingCartera}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCambiarCartera}
                disabled={savingCartera || !carteraNuevoTipo || !carteraMotivo.trim() || !carteraConfirm}
                className="px-4 py-2 text-sm font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingCartera && (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {savingCartera ? 'Guardando…' : 'Confirmar Cambio'}
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
