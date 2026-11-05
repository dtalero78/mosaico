'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import { UsersIcon, ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { RecaudosPermission } from '@/types/permissions'
import { formatCurrency } from '@/lib/utils'
import { api, handleApiError } from '@/hooks/use-api'
import { exportToExcel } from '@/lib/export-excel'

interface AsignacionRow {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido: string | null
  numeroId: string
  contrato: string | null
  fechaContrato: string | null
  plataforma: string | null
  gestorRecaudo: string | null
  estadoInactivo: boolean | null
  aprobacion: string | null
  saldoActual: string | null
  tipoCartera: string
  ultimaFechaPago: string | null
  ultimaCuotaPagada: number | null
  /**
   * Fecha del primer pago definida en el contrato (FINANCIEROS.fechaPago).
   * Es la fecha base elegida al crear/migrar el contrato — independiente de
   * si el titular ya tiene pagos registrados. Hasta mayo 2026 se mostraba
   * sólo el día del mes; ahora la fecha completa.
   */
  fechaPrimerPago: string | null
  /**
   * Marca manual del área de Recaudo. Alimentada vía botón "Opcional" en
   * /person/[id] → Tab Financiera. Valores actuales: 'OPC' o null.
   * Reemplaza al cálculo automático que usaba fechaPrimerPago > día 27 +
   * regla ANT (eliminado en mayo 2026).
   */
  marcaOpcional: string | null
}

interface DisplayUser {
  _id: string
  email: string
  nombre: string
  rol: string
  activo?: boolean
}

const GESTOR_ROLES_FILTRO = ['RECAUDOS_ASESOR', 'RECAUDOS_JEFE']
const ROLE_LABEL: Record<string, string> = {
  RECAUDOS_ASESOR: 'Asesor',
  RECAUDOS_JEFE: 'Jefe',
}

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

const PAGE_SIZE = 50

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { timeZone: 'UTC' }) } catch { return '—' }
}
function parseMoneyText(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return v
  const cleaned = String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

export default function AsignacionRecaudosPage() {
  const { data: session } = useSession()
  const userRole = ((session?.user as any)?.role ?? '').toString()
  const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'admin'
  const isJefe  = userRole === 'RECAUDOS_JEFE'
  // RECAUDOS_ASESOR no puede filtrar por gestor (siempre se ve a sí mismo)
  const canFiltrarGestor = isAdmin || isJefe

  // Filtros
  const [search, setSearch] = useState('')
  const [estadoCartera, setEstadoCartera] = useState<'' | 'normal' | 'prejuridico' | 'ultimopago' | 'penalidad'>('')
  const [gestorFiltro, setGestorFiltro] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  // Datos
  const [titulares, setTitulares] = useState<AsignacionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [displayUsers, setDisplayUsers] = useState<DisplayUser[]>([])
  // Gestores INCLUYENDO inactivos — el origen de una migración suele ser
  // justamente un gestor dado de baja.
  const [gestoresTodos, setGestoresTodos] = useState<DisplayUser[]>([])

  // ── Migrar Cuentas ──
  const [showMigrar, setShowMigrar] = useState(false)
  const [migrarOrigen, setMigrarOrigen] = useState('')
  const [migrarDestino, setMigrarDestino] = useState('')
  const [migrarPagos, setMigrarPagos] = useState(true)
  const [migrarConfirmado, setMigrarConfirmado] = useState(false)
  const [migrarPreview, setMigrarPreview] = useState<{ titulares: number; pagosPendientes: number; pagosValidados: number } | null>(null)
  const [migrarLoading, setMigrarLoading] = useState(false)
  const [migrando, setMigrando] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /** Preview de lo que se migraría al elegir el gestor de origen. */
  useEffect(() => {
    if (!migrarOrigen) { setMigrarPreview(null); return }
    setMigrarLoading(true)
    api.get<{ titulares: number; pagosPendientes: number; pagosValidados: number }>(
      `/api/postgres/recaudos/migrar-cuentas?origen=${encodeURIComponent(migrarOrigen)}`,
    )
      .then(d => setMigrarPreview({ titulares: d.titulares, pagosPendientes: d.pagosPendientes, pagosValidados: d.pagosValidados }))
      .catch(() => setMigrarPreview(null))
      .finally(() => setMigrarLoading(false))
  }, [migrarOrigen])

  const abrirMigrar = () => {
    setMigrarOrigen(''); setMigrarDestino('')
    setMigrarPagos(true); setMigrarConfirmado(false)
    setMigrarPreview(null); setShowMigrar(true)
  }

  const ejecutarMigracion = async () => {
    setMigrando(true)
    try {
      const d = await api.post<{ titularesMigrados: number; pagosMigrados: number; origenNombre: string; destinoNombre: string }>(
        '/api/postgres/recaudos/migrar-cuentas',
        { origen: migrarOrigen, destino: migrarDestino, migrarPagosPendientes: migrarPagos },
      )
      toast.success(
        `${d.titularesMigrados} titular(es) migrados de ${d.origenNombre} a ${d.destinoNombre}` +
        (d.pagosMigrados ? ` · ${d.pagosMigrados} pago(s) pendientes` : ''),
      )
      setShowMigrar(false)
      fetchTitulares()
    } catch (err) {
      handleApiError(err, 'Error al migrar las cuentas')
    } finally {
      setMigrando(false)
    }
  }

  const fetchTitulares = useCallback(async (resetPage = false) => {
    setLoading(true)
    try {
      const pageToUse = resetPage ? 1 : page
      const qs = new URLSearchParams()
      if (search.trim()) qs.set('search', search.trim())
      if (estadoCartera) qs.set('estadoCartera', estadoCartera)
      if (canFiltrarGestor && gestorFiltro) qs.set('gestorRecaudo', gestorFiltro)
      if (fechaInicio) qs.set('fechaInicio', fechaInicio)
      if (fechaFin) qs.set('fechaFin', fechaFin)
      qs.set('page', String(pageToUse))
      qs.set('pageSize', String(PAGE_SIZE))
      const data = await api.get<{ titulares: AsignacionRow[]; total: number; page: number }>(
        `/api/postgres/recaudos/asignaciones?${qs.toString()}`
      )
      setTitulares(data.titulares || [])
      setTotal(data.total || 0)
      if (resetPage) setPage(1)
    } catch (err) {
      handleApiError(err, 'Error cargando asignaciones')
    } finally {
      setLoading(false)
    }
  }, [search, estadoCartera, gestorFiltro, fechaInicio, fechaFin, page, canFiltrarGestor])

  // Carga de gestores (solo si el rol los puede filtrar)
  useEffect(() => {
    if (!canFiltrarGestor) return
    api.get<{ users: DisplayUser[] }>(`/api/postgres/users/by-role?roles=${GESTOR_ROLES_FILTRO.join(',')}&activeOnly=true`)
      .then(d => setDisplayUsers(d.users || []))
      .catch(() => {})
    // Lista completa (con inactivos) para el modal de migración.
    api.get<{ users: DisplayUser[] }>(`/api/postgres/users/by-role?roles=${GESTOR_ROLES_FILTRO.join(',')}&activeOnly=false`)
      .then(d => setGestoresTodos(d.users || []))
      .catch(() => {})
  }, [canFiltrarGestor])

  useEffect(() => { fetchTitulares() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])
  useEffect(() => { fetchTitulares(true) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAplicar = () => fetchTitulares(true)
  const handleLimpiar = () => {
    setSearch(''); setEstadoCartera(''); setGestorFiltro(''); setFechaInicio(''); setFechaFin('')
    setTimeout(() => fetchTitulares(true), 0)
  }

  const handleExport = () => {
    if (!titulares.length) { toast.error('No hay titulares para exportar'); return }
    const rows = titulares.map(t => ({
      Titular: `${t.primerNombre} ${t.primerApellido} ${t.segundoApellido ?? ''}`.trim(),
      'Número ID': t.numeroId,
      Contrato: t.contrato || '',
      'Fecha Contrato': fmtDate(t.fechaContrato),
      'Fecha 1er Pago': fmtDate(t.fechaPrimerPago),
      Opcional: t.marcaOpcional === 'OPC' ? 'OPC' : '',
      'Fecha Último Pago': fmtDate(t.ultimaFechaPago),
      'Última Cuota Pagada': t.ultimaCuotaPagada ?? '',
      'Saldo Actual': parseMoneyText(t.saldoActual),
      'Estado Cartera': ESTADO_CARTERA_META[t.tipoCartera]?.label || t.tipoCartera,
      'Estado Contrato': t.estadoInactivo ? 'Aprobada' : 'Activo',
      Plataforma: t.plataforma || '',
    }))
    const columns = (Object.keys(rows[0]) as Array<keyof typeof rows[0]>).map(k => ({
      header: String(k),
      accessor: (row: typeof rows[0]) => row[k] as any,
    }))
    const today = new Date()
    const fname = `usuarios-asignados-${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}.csv`
    exportToExcel(rows, columns, fname)
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={RecaudosPermission.ASIGNACION_VER} showDefaultMessage>
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <UsersIcon className="h-7 w-7 text-purple-600" />
                Usuarios Asignados
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Titulares asignados al gestor de recaudo
                {!canFiltrarGestor ? ` (sólo los tuyos)` : ''}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PermissionGuard permission={RecaudosPermission.ASIGNACION_EXPORTAR}>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!titulares.length || loading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" /> Exportar Excel
                </button>
              </PermissionGuard>
              <PermissionGuard permission={RecaudosPermission.ASIGNACION_MIGRAR}>
                <button
                  type="button"
                  onClick={abrirMigrar}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700"
                  title="Pasar toda la cartera de un gestor a otro (retiro o reemplazo)"
                >
                  <ArrowsRightLeftIcon className="h-4 w-4" /> Migrar Cuentas
                </button>
              </PermissionGuard>
              <button
                type="button"
                onClick={() => fetchTitulares()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
              </button>
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label htmlFor="search" className="block text-xs font-medium text-gray-700">Buscar (titular, ID, contrato)</label>
              <div className="mt-1 relative">
                <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="search" type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAplicar() }}
                  placeholder="Apellido o nombre del titular..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="estadoCartera" className="block text-xs font-medium text-gray-700">Estado Cartera</label>
              <select
                id="estadoCartera" value={estadoCartera}
                onChange={e => setEstadoCartera(e.target.value as any)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Todos</option>
                <option value="normal">Normal</option>
                <option value="prejuridico">Prejurídico</option>
                <option value="ultimopago">Último Pago</option>
                <option value="penalidad">Penalidad</option>
              </select>
            </div>
            <div>
              <label htmlFor="gestorFiltro" className="block text-xs font-medium text-gray-700">
                Gestor de Recaudo {!canFiltrarGestor && <span className="text-gray-400">(solo Jefe)</span>}
              </label>
              <select
                id="gestorFiltro" value={gestorFiltro}
                onChange={e => setGestorFiltro(e.target.value)}
                disabled={!canFiltrarGestor}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">{canFiltrarGestor ? 'Todos' : 'Solo tus titulares'}</option>
                {displayUsers.map(u => (
                  <option key={u._id} value={u._id}>
                    {u.nombre} · {ROLE_LABEL[u.rol] || u.rol}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fechaInicio" className="block text-xs font-medium text-gray-700">Contrato desde</label>
              <input
                id="fechaInicio" type="date" value={fechaInicio}
                onChange={e => setFechaInicio(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="fechaFin" className="block text-xs font-medium text-gray-700">Contrato hasta</label>
              <input
                id="fechaFin" type="date" value={fechaFin}
                onChange={e => setFechaFin(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div className="md:col-span-6 flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={handleLimpiar}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
                Limpiar filtros
              </button>
              <button type="button" onClick={handleAplicar}
                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700">
                Aplicar
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Titulares ({total})</h3>
              <span className="text-xs text-gray-500">Página {page} de {totalPages}</span>
            </div>

            {loading ? (
              <p className="p-6 text-sm text-gray-400 italic text-center">Cargando…</p>
            ) : titulares.length === 0 ? (
              <p className="p-6 text-sm text-gray-400 italic text-center">No hay titulares con los filtros seleccionados</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Titular</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Contrato</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Contrato</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha 1er Pago</th>
                      <th
                        className="px-2 py-2 text-center font-medium text-gray-700"
                        title="OPC = marca manual desde /person/[id] → Tab Financiera, botón Opcional. Alimentación 100% manual del equipo de Recaudo."
                      >
                        Opcional
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Último Pago</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700">Última Cuota Pagada</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700">Saldo a la Fecha</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700">Estado Cartera</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700">Estado Contrato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {titulares.map(t => {
                      const titularNombre = `${t.primerNombre} ${t.primerApellido}`.trim()
                      const estadoMeta = ESTADO_CARTERA_META[t.tipoCartera]
                        || { label: t.tipoCartera, cls: 'bg-gray-100 text-gray-800' }
                      const saldoNum = parseMoneyText(t.saldoActual)
                      return (
                        <tr key={t._id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <Link
                              href={`/person/${t._id}?tab=financiera`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline font-medium"
                            >
                              {titularNombre || '—'}
                            </Link>
                            <div className="text-[11px] text-gray-500">ID {t.numeroId}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{t.contrato || '—'}</td>
                          <td className="px-3 py-2 text-gray-900">{fmtDate(t.fechaContrato)}</td>
                          <td className="px-3 py-2 text-gray-900">{fmtDate(t.fechaPrimerPago)}</td>
                          <td className="px-2 py-2 text-center">
                            {(() => {
                              if (t.marcaOpcional === 'OPC') return (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                                  OPC
                                </span>
                              )
                              return <span className="text-gray-300">—</span>
                            })()}
                          </td>
                          <td className="px-3 py-2 text-gray-900">{fmtDate(t.ultimaFechaPago)}</td>
                          <td className="px-3 py-2 text-center text-gray-900 font-medium">
                            {t.ultimaCuotaPagada != null ? t.ultimaCuotaPagada : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-900 font-medium">
                            {saldoNum > 0 ? formatCurrency(saldoNum) : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${estadoMeta.cls}`}>
                              {estadoMeta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {t.estadoInactivo ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                Aprobada
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                Activo
                              </span>
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
            {titulares.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
                <span className="text-gray-500 text-xs">
                  {((page - 1) * PAGE_SIZE) + 1} – {Math.min(page * PAGE_SIZE, total)} de {total}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                    Anterior
                  </button>
                  <span className="text-xs text-gray-700">Página {page} de {totalPages}</span>
                  <button type="button"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* ── Modal: Migrar Cuentas ─────────────────────────────────────── */}
        {showMigrar && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">Migrar cuentas entre gestores</h3>
              <p className="text-sm text-gray-500 mb-4">
                Pasa <strong>toda la cartera</strong> de un gestor a otro. Pensado para cuando el gestor anterior se retira.
              </p>

              {/* Origen */}
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-700 mb-1">Gestor actual (origen)</span>
                <select
                  value={migrarOrigen}
                  onChange={e => { setMigrarOrigen(e.target.value); setMigrarConfirmado(false) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Selecciona…</option>
                  {gestoresTodos.map(u => (
                    <option key={u._id} value={u._id}>
                      {u.nombre}{u.activo === false ? ' — INACTIVO' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {/* Preview de lo que se va a mover */}
              {migrarLoading && <p className="text-sm text-gray-500 mb-3">Consultando cartera…</p>}
              {migrarPreview && !migrarLoading && (
                <div className="mb-3 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Titulares a migrar</span><span className="font-semibold tabular-nums">{migrarPreview.titulares}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Pagos pendientes</span><span className="font-semibold tabular-nums">{migrarPreview.pagosPendientes}</span></div>
                  <div className="flex justify-between text-gray-400"><span>Pagos ya validados (no se tocan)</span><span className="tabular-nums">{migrarPreview.pagosValidados}</span></div>
                  {migrarPreview.titulares === 0 && (
                    <p className="text-xs text-amber-700 mt-2">Este gestor no tiene titulares asignados dentro de tu alcance.</p>
                  )}
                </div>
              )}

              {/* Destino */}
              <label className="block mb-3">
                <span className="block text-sm font-medium text-gray-700 mb-1">Nuevo gestor (destino)</span>
                <select
                  value={migrarDestino}
                  onChange={e => { setMigrarDestino(e.target.value); setMigrarConfirmado(false) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Selecciona…</option>
                  {gestoresTodos.filter(u => u.activo !== false && u._id !== migrarOrigen).map(u => (
                    <option key={u._id} value={u._id}>{u.nombre}</option>
                  ))}
                </select>
                <span className="block text-xs text-gray-500 mt-1">Solo aparecen gestores activos.</span>
              </label>

              {/* Pagos pendientes */}
              <label className="flex items-start gap-2 mb-3 cursor-pointer">
                <input type="checkbox" checked={migrarPagos} onChange={e => setMigrarPagos(e.target.checked)} className="mt-1" />
                <span className="text-sm text-gray-700">
                  Migrar también sus <strong>pagos pendientes</strong>
                  <span className="block text-xs text-gray-500">
                    Los pagos <strong>ya validados</strong> nunca se migran: dejan constancia de quién los gestionó.
                  </span>
                </span>
              </label>

              {/* Confirmación */}
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={migrarConfirmado}
                    onChange={e => setMigrarConfirmado(e.target.checked)}
                    disabled={!migrarOrigen || !migrarDestino || !migrarPreview?.titulares}
                    className="mt-1"
                  />
                  <span className="text-sm text-amber-900">
                    Confirmo la migración de <strong>{migrarPreview?.titulares ?? 0} titular(es)</strong>
                    {migrarPagos && migrarPreview?.pagosPendientes ? <> y <strong>{migrarPreview.pagosPendientes} pago(s) pendientes</strong></> : null}.
                    <span className="block text-xs text-amber-700 mt-0.5">
                      No se puede deshacer desde la pantalla: revertirlo exige migrar de vuelta.
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowMigrar(false)}
                  disabled={migrando}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={ejecutarMigracion}
                  disabled={migrando || !migrarConfirmado || !migrarOrigen || !migrarDestino || !migrarPreview?.titulares}
                  className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {migrando ? 'Migrando…' : 'Migrar cuentas'}
                </button>
              </div>
            </div>
          </div>
        )}
      </PermissionGuard>
    </DashboardLayout>
  )
}
