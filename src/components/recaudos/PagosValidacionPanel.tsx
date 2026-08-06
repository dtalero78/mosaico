'use client'

/**
 * Panel reutilizable de validación de pagos (Recaudos).
 *
 * Lo usan dos páginas con la MISMA consulta/acciones, cambiando solo el
 * filtro+columna lateral según `variant`:
 *   - variant='gestor'    → Centro de Validación de Pagos (filtro/columna Gestor de Recaudo)
 *   - variant='medioPago' → Bancos (filtro/columna Medio de Pago)
 *
 * Dos pestañas en ambas: "Pagos pendientes" (cuotas numCuota>0) e
 * "Inscripciones pendientes" (cuota #0).
 */
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { BanknotesIcon, BuildingLibraryIcon, CheckBadgeIcon, ArrowPathIcon, ArrowDownTrayIcon, MagnifyingGlassIcon, XMarkIcon, DocumentTextIcon, PaperClipIcon, ArrowTopRightOnSquareIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { PersonPermission, RecaudosPermission } from '@/types/permissions'
import { formatCurrency } from '@/lib/utils'
import { mediosPagoPara } from '@/lib/medios-pago'
import { api, handleApiError } from '@/hooks/use-api'
import { usePermissions } from '@/hooks/usePermissions'
import { exportToExcel } from '@/lib/export-excel'

interface DocAdjunto { url: string; nombre?: string | null; tipo?: string | null; fechaSubida?: string | null }

interface PagoRow {
  _id: string
  idPeople: string
  numCuota: number | null
  fechaPago: string | null
  valorPagado: number | null
  descuento: number | null
  validado: boolean
  fechaValidacion: string | null
  validadoPor: string | null
  numeroFactura: string | null
  numeroReferencia: string | null
  numeroRecibo: string | null
  gestorRecaudo: string | null
  medioPago: string | null
  titular_primerNombre: string
  titular_primerApellido: string
  titular_segundoApellido: string | null
  titular_numeroId: string
  titular_contrato: string | null
  titular_plataforma: string | null
  documentosAdjuntos: DocAdjunto[] | null
}

interface DisplayUser { _id: string; email: string; nombre: string; rol: string }

type Variant = 'gestor' | 'medioPago'
type CuotaTipo = 'regular' | 'inscripcion'

const DISPLAY_ROLES = ['RECAUDOS_ASESOR', 'RECAUDOS_JEFE', 'COMERCIAL', 'SUPER_ADMIN', 'ADMIN']
const ROLE_LABEL: Record<string, string> = { RECAUDOS_ASESOR: 'Asesor', RECAUDOS_JEFE: 'Jefe', COMERCIAL: 'Comercial', SUPER_ADMIN: 'Admin', ADMIN: 'Admin' }
const PAGE_SIZE = 50
const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú']

function getLocalToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('es', { timeZone: 'UTC' }) } catch { return '—' }
}

export default function PagosValidacionPanel({ variant }: { variant: Variant }) {
  const { hasPermission } = usePermissions()
  const canValidar = hasPermission(PersonPermission.PAGOS_VALIDAR)
  const canRecibo = hasPermission(PersonPermission.PAGOS_RECIBO)
  const canEditar = hasPermission(PersonPermission.PAGOS_EDITAR)
  // Aprobación EN BLOQUE — gateada por rol (permiso propio).
  const canAprobarMasivo = hasPermission(RecaudosPermission.APROBACION_MASIVA)

  const isGestor = variant === 'gestor'
  const lateralLabel = isGestor ? 'Gestor de Recaudo' : 'Medio de Pago'

  // Pestaña: cuotas regulares vs inscripciones (cuota #0)
  const [cuotaTipo, setCuotaTipo] = useState<CuotaTipo>('regular')

  // Filtros
  const [estado, setEstado] = useState<'' | 'validado' | 'pendiente'>('pendiente')
  const [search, setSearch] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [gestorFiltro, setGestorFiltro] = useState('')
  const [medioFiltro, setMedioFiltro] = useState('')
  const [plataformaFiltro, setPlataformaFiltro] = useState('')

  // Datos
  const [pagos, setPagos] = useState<PagoRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [displayUsers, setDisplayUsers] = useState<DisplayUser[]>([])
  const [medios, setMedios] = useState<string[]>([])

  // Modales
  const [validateModal, setValidateModal] = useState<{ id: string; numCuota: number | null; titular: string; medioPago: string | null } | null>(null)
  const [facturaInput, setFacturaInput] = useState('')
  const [validating, setValidating] = useState(false)
  const [docsModal, setDocsModal] = useState<{ titular: string; numCuota: number | null; docs: DocAdjunto[] } | null>(null)

  // Edición de pago pendiente
  const [editModal, setEditModal] = useState<{ id: string; titular: string; numCuota: number | null } | null>(null)
  const [editForm, setEditForm] = useState({ fechaPago: '', valorPagado: '', descuento: '', medioPago: '', numeroReferencia: '', numCuota: '' })
  const [editing, setEditing] = useState(false)

  // Selección para aprobación masiva
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkFactura, setBulkFactura] = useState('')
  const [bulkValidating, setBulkValidating] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchPagos = useCallback(async (resetPage = false) => {
    setLoading(true)
    try {
      const pageToUse = resetPage ? 1 : page
      const qs = new URLSearchParams()
      qs.set('cuotaTipo', cuotaTipo)
      if (estado) qs.set('estado', estado)
      if (search.trim()) qs.set('search', search.trim())
      if (fechaInicio) qs.set('fechaInicio', fechaInicio)
      if (fechaFin) qs.set('fechaFin', fechaFin)
      if (isGestor) { if (gestorFiltro) qs.set('gestorRecaudo', gestorFiltro) }
      else { if (medioFiltro) qs.set('medioPago', medioFiltro) }
      if (plataformaFiltro) qs.set('plataforma', plataformaFiltro)
      qs.set('page', String(pageToUse))
      qs.set('pageSize', String(PAGE_SIZE))
      const data = await api.get<{ pagos: PagoRow[]; total: number }>(`/api/postgres/recaudos/pagos?${qs.toString()}`)
      setPagos(data.pagos || [])
      setTotal(data.total || 0)
      setSelected(new Set())
      if (resetPage) setPage(1)
    } catch (err) {
      handleApiError(err, 'Error cargando pagos')
    } finally {
      setLoading(false)
    }
  }, [cuotaTipo, estado, search, fechaInicio, fechaFin, isGestor, gestorFiltro, medioFiltro, plataformaFiltro, page])

  // Carga de catálogos según variante
  useEffect(() => {
    if (isGestor) {
      api.get<{ users: DisplayUser[] }>(`/api/postgres/users/by-role?roles=${DISPLAY_ROLES.join(',')}&activeOnly=true`)
        .then(d => setDisplayUsers(d.users || [])).catch(() => {})
    } else {
      api.get<{ medios: string[] }>(`/api/postgres/recaudos/medios-pago`)
        .then(d => setMedios(d.medios || [])).catch(() => {})
    }
  }, [isGestor])

  useEffect(() => { fetchPagos() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page])
  useEffect(() => { fetchPagos(true) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  // Al cambiar de pestaña, refetch desde la página 1
  useEffect(() => { fetchPagos(true) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cuotaTipo])

  const handleAplicarFiltros = () => fetchPagos(true)
  const handleLimpiar = () => {
    setEstado('pendiente'); setSearch(''); setFechaInicio(''); setFechaFin(''); setGestorFiltro(''); setMedioFiltro(''); setPlataformaFiltro('')
    setTimeout(() => fetchPagos(true), 0)
  }

  const openValidar = (p: PagoRow) => {
    setFacturaInput('')
    setValidateModal({ id: p._id, numCuota: p.numCuota, titular: `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim(), medioPago: p.medioPago })
  }

  const handleValidar = async () => {
    if (!validateModal) return
    const factura = facturaInput.trim() // opcional
    setValidating(true)
    try {
      await api.post(`/api/postgres/pagos-titulares/${validateModal.id}/validar`, { numeroFactura: factura, fechaValidacion: getLocalToday() })
      toast.success(cuotaTipo === 'inscripcion' ? 'Inscripción validada' : 'Pago validado')
      setValidateModal(null); setFacturaInput('')
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error al validar pago')
    } finally {
      setValidating(false)
    }
  }

  // ── Editar pago pendiente ──────────────────────────────────────────────
  const openEditar = (p: PagoRow) => {
    setEditForm({
      fechaPago: (p.fechaPago || '').slice(0, 10),
      valorPagado: p.valorPagado != null ? String(p.valorPagado) : '',
      descuento: p.descuento != null ? String(p.descuento) : '',
      medioPago: p.medioPago || '',
      numeroReferencia: p.numeroReferencia || '',
      numCuota: p.numCuota != null ? String(p.numCuota) : '',
    })
    setEditModal({ id: p._id, titular: `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim(), numCuota: p.numCuota })
  }

  const editMedios = (() => {
    const p = pagos.find(x => x._id === editModal?.id)
    return mediosPagoPara(p?.titular_plataforma ?? undefined)
  })()

  const handleEditar = async () => {
    if (!editModal) return
    setEditing(true)
    try {
      await api.patch(`/api/postgres/pagos-titulares/${editModal.id}`, {
        fechaPago: editForm.fechaPago || null,
        valorPagado: editForm.valorPagado === '' ? null : Number(editForm.valorPagado),
        descuento: editForm.descuento === '' ? 0 : Number(editForm.descuento),
        medioPago: editForm.medioPago.trim() || null,
        numeroReferencia: editForm.numeroReferencia.trim() || null,
        numCuota: editForm.numCuota === '' ? null : Number(editForm.numCuota),
      })
      toast.success('Pago actualizado')
      setEditModal(null)
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error al actualizar el pago')
    } finally {
      setEditing(false)
    }
  }

  // ── Aprobación masiva ──────────────────────────────────────────────────
  const pendientes = pagos.filter(p => !p.validado)
  const allPendingSelected = pendientes.length > 0 && pendientes.every(p => selected.has(p._id))
  const selectedCount = pendientes.filter(p => selected.has(p._id)).length

  const toggleOne = (id: string) => setSelected(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const toggleAllPending = () => setSelected(prev =>
    allPendingSelected ? new Set() : new Set(pendientes.map(p => p._id))
  )

  const handleBulkValidar = async () => {
    const ids = pendientes.filter(p => selected.has(p._id)).map(p => p._id)
    if (ids.length === 0) return
    setBulkValidating(true)
    try {
      const r = await api.post<{ ok: number; fail: number }>(
        `/api/postgres/pagos-titulares/validar-masivo`,
        { ids, numeroFactura: bulkFactura.trim(), fechaValidacion: getLocalToday() }
      )
      const noun = cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'
      toast.success(`${r.ok} ${noun} validado(s)${r.fail ? ` · ${r.fail} con error` : ''}`)
      setBulkModal(false); setBulkFactura('')
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error en la aprobación masiva')
    } finally {
      setBulkValidating(false)
    }
  }

  const handleGenerarRecibo = async (id: string) => {
    const tid = toast.loading('Generando recibo…')
    try {
      const data = await api.post<{ pdfUrl: string; numeroRecibo: string }>(`/api/postgres/pagos-titulares/${id}/recibo`, {})
      toast.success(`Recibo ${data.numeroRecibo} generado`, { id: tid })
      if (data.pdfUrl) window.open(data.pdfUrl, '_blank', 'noopener,noreferrer')
      fetchPagos()
    } catch (err) {
      toast.dismiss(tid); handleApiError(err, 'Error generando recibo')
    }
  }

  const gestorNombre = (p: PagoRow) => {
    const g = displayUsers.find(u => u._id === p.gestorRecaudo) || displayUsers.find(u => u.email === p.gestorRecaudo)
    return g?.nombre || p.gestorRecaudo || ''
  }

  const handleExport = () => {
    if (!pagos.length) { toast.error('No hay pagos para exportar'); return }
    const rows = pagos.map(p => ({
      Titular: `${p.titular_primerNombre} ${p.titular_primerApellido} ${p.titular_segundoApellido ?? ''}`.trim(),
      'Número ID': p.titular_numeroId,
      Contrato: p.titular_contrato || '',
      'Cuota #': p.numCuota ?? '',
      'Fecha Pago': fmtDate(p.fechaPago),
      'Valor Pagado': p.valorPagado ?? 0,
      Descuento: p.descuento ?? 0,
      [lateralLabel]: isGestor ? gestorNombre(p) : (p.medioPago || ''),
      Validado: p.validado ? 'Sí' : 'No',
      'Fecha Validación': fmtDate(p.fechaValidacion),
      'Validado por': p.validadoPor || '',
      '# Factura': p.numeroFactura || '',
      Plataforma: p.titular_plataforma || '',
    }))
    const columns = (Object.keys(rows[0]) as Array<keyof typeof rows[0]>).map(k => ({ header: String(k), accessor: (row: typeof rows[0]) => row[k] as any }))
    const fileBase = isGestor ? 'centro-validacion-pagos' : 'bancos'
    exportToExcel(rows, columns, `${fileBase}-${cuotaTipo}-${getLocalToday()}.csv`)
  }

  const countLabel = cuotaTipo === 'inscripcion' ? 'Inscripciones' : 'Pagos'

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {isGestor ? <BanknotesIcon className="h-7 w-7 text-purple-600" /> : <BuildingLibraryIcon className="h-7 w-7 text-purple-600" />}
            {isGestor ? 'Centro de Validación de Pagos' : 'Bancos'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isGestor ? 'Pagos registrados pendientes de validación por recaudos.' : 'Pagos registrados, consultados por medio de pago.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleExport} disabled={!pagos.length || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50">
            <ArrowDownTrayIcon className="h-4 w-4" /> Exportar Excel
          </button>
          <button type="button" onClick={() => fetchPagos()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-gray-200">
        <button type="button" onClick={() => setCuotaTipo('regular')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${cuotaTipo === 'regular' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}>
          Pagos pendientes
        </button>
        <button type="button" onClick={() => setCuotaTipo('inscripcion')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${cuotaTipo === 'inscripcion' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}>
          Inscripciones pendientes
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
        <div className="md:col-span-2">
          <label htmlFor="search" className="block text-xs font-medium text-gray-700">Buscar (titular, ID, contrato)</label>
          <div className="mt-1 relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input id="search" type="text" value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAplicarFiltros() }}
              placeholder="Apellido o nombre del titular..." className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
        </div>
        <div>
          <label htmlFor="estado" className="block text-xs font-medium text-gray-700">Estado</label>
          <select id="estado" value={estado} onChange={e => setEstado(e.target.value as any)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
            <option value="">Todos</option>
            <option value="pendiente">Pendientes</option>
            <option value="validado">Validados</option>
          </select>
        </div>
        <div>
          <label htmlFor="lateral" className="block text-xs font-medium text-gray-700">{lateralLabel}</label>
          {isGestor ? (
            <select id="lateral" value={gestorFiltro} onChange={e => setGestorFiltro(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">Todos</option>
              {displayUsers.filter(u => u.rol === 'RECAUDOS_ASESOR' || u.rol === 'RECAUDOS_JEFE').map(u => (
                <option key={u._id} value={u._id}>{u.nombre} · {ROLE_LABEL[u.rol] || u.rol}</option>
              ))}
            </select>
          ) : (
            <select id="lateral" value={medioFiltro} onChange={e => setMedioFiltro(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="">Todos</option>
              {medios.map(m => (<option key={m} value={m}>{m}</option>))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor="plataformaFiltro" className="block text-xs font-medium text-gray-700">Plataforma</label>
          <select id="plataformaFiltro" value={plataformaFiltro} onChange={e => setPlataformaFiltro(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
            <option value="">Todas</option>
            {PLATAFORMAS.map(pf => (<option key={pf} value={pf}>{pf}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="fechaInicio" className="block text-xs font-medium text-gray-700">Fecha desde</label>
          <input id="fechaInicio" type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
        </div>
        <div>
          <label htmlFor="fechaFin" className="block text-xs font-medium text-gray-700">Fecha hasta</label>
          <input id="fechaFin" type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
        </div>
        <div className="md:col-span-7 flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={handleLimpiar} className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Limpiar filtros</button>
          <button type="button" onClick={handleAplicarFiltros} className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700">Aplicar</button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">
            {countLabel} {estado === 'pendiente' ? 'pendientes' : estado === 'validado' ? 'validados' : ''} ({total})
          </h3>
          <span className="text-xs text-gray-500">Página {page} de {totalPages}</span>
        </div>

        {/* Barra de aprobación masiva (solo con permiso + selección) */}
        {canAprobarMasivo && selectedCount > 0 && (
          <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-emerald-900">{selectedCount} seleccionado(s)</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md bg-white hover:bg-gray-50">Limpiar</button>
              <button type="button" onClick={() => { setBulkFactura(''); setBulkModal(true) }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700">
                <CheckBadgeIcon className="h-4 w-4" /> Aprobar seleccionados
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="p-6 text-sm text-gray-400 italic text-center">Cargando…</p>
        ) : pagos.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 italic text-center">No hay {countLabel.toLowerCase()} con los filtros seleccionados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {canAprobarMasivo && (
                    <th className="px-3 py-2 w-8 text-center">
                      <input type="checkbox" aria-label="Seleccionar todos los pendientes"
                        title="Seleccionar todos los pendientes de esta página"
                        checked={allPendingSelected} disabled={pendientes.length === 0}
                        onChange={toggleAllPending} />
                    </th>
                  )}
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Titular</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Pago</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Contrato</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-700">Cuota #</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Valor Pagado</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">{lateralLabel}</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-700">Validado</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Fecha Validación</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Validado por</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagos.map(p => {
                  const titularNombre = `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim()
                  const g = displayUsers.find(u => u._id === p.gestorRecaudo) || displayUsers.find(u => u.email === p.gestorRecaudo)
                  return (
                    <tr key={p._id} className={`hover:bg-gray-50 ${selected.has(p._id) ? 'bg-emerald-50/40' : ''}`}>
                      {canAprobarMasivo && (
                        <td className="px-3 py-2 text-center">
                          {!p.validado ? (
                            <input type="checkbox" aria-label={`Seleccionar pago de ${p.titular_primerNombre}`}
                              checked={selected.has(p._id)} onChange={() => toggleOne(p._id)} />
                          ) : (
                            <CheckBadgeIcon className="h-4 w-4 text-emerald-500 mx-auto" />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Link href={`/person/${p.idPeople}?tab=financiera`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                          {titularNombre || '—'}
                        </Link>
                        <div className="text-[11px] text-gray-500">ID {p.titular_numeroId}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-900">{fmtDate(p.fechaPago)}</td>
                      <td className="px-3 py-2 text-gray-700">{p.titular_contrato || '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-900 font-medium">{p.numCuota === 0 ? 'Inscripción' : (p.numCuota ?? '—')}</td>
                      <td className="px-3 py-2 text-right text-gray-900 font-medium">{p.valorPagado ? formatCurrency(p.valorPagado) : '—'}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {isGestor ? (
                          g ? (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">{ROLE_LABEL[g.rol] || g.rol}</span>
                              <span className="text-xs">{g.nombre}</span>
                            </div>
                          ) : <span className="text-xs text-gray-400 italic">{p.gestorRecaudo || '—'}</span>
                        ) : (
                          <span className="text-xs">{p.medioPago || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {p.validado ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckBadgeIcon className="h-3.5 w-3.5" /> Sí</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Pendiente</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700 text-xs">{fmtDate(p.fechaValidacion)}</td>
                      <td className="px-3 py-2 text-gray-700 text-xs" title={p.validadoPor || ''}>{p.validadoPor ? p.validadoPor.split('@')[0] : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {Array.isArray(p.documentosAdjuntos) && p.documentosAdjuntos.length > 0 && (
                            <button type="button" onClick={() => setDocsModal({ titular: titularNombre, numCuota: p.numCuota, docs: p.documentosAdjuntos as DocAdjunto[] })}
                              title="Ver documentos del pago" className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200">
                              <PaperClipIcon className="h-3.5 w-3.5" /> Docs ({p.documentosAdjuntos.length})
                            </button>
                          )}
                          {!p.validado && canEditar && (
                            <button type="button" onClick={() => openEditar(p)} title="Editar pago" className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-amber-500 rounded hover:bg-amber-600">
                              <PencilSquareIcon className="h-3.5 w-3.5" /> Editar
                            </button>
                          )}
                          {!p.validado && canValidar && (
                            <button type="button" onClick={() => openValidar(p)} title="Validar pago" className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700">
                              <CheckBadgeIcon className="h-3.5 w-3.5" /> Validar
                            </button>
                          )}
                          {p.validado && canRecibo && (
                            <button type="button" onClick={() => handleGenerarRecibo(p._id)} title={p.numeroRecibo ? `Descargar recibo ${p.numeroRecibo}` : 'Generar recibo de pago'} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">
                              <DocumentTextIcon className="h-3.5 w-3.5" /> Recibo
                            </button>
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

        {pagos.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
            <span className="text-gray-500 text-xs">{((page - 1) * PAGE_SIZE) + 1} – {Math.min(page * PAGE_SIZE, total)} de {total}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Anterior</button>
              <span className="text-xs text-gray-700">Página {page} de {totalPages}</span>
              <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">Siguiente</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal validar */}
      {validateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">✅ Validar {validateModal.numCuota === 0 ? 'Inscripción' : 'Pago'}</h3>
              <button type="button" onClick={() => setValidateModal(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Confirme la validación del pago{validateModal.numCuota != null ? (validateModal.numCuota === 0 ? ' (inscripción)' : ` (cuota ${validateModal.numCuota})`) : ''}
              {' '}de <strong>{validateModal.titular}</strong>
              {validateModal.medioPago ? <>, con el medio de pago <strong>{validateModal.medioPago}</strong></> : ''}.
              {' '}Si posee el <strong>número de factura</strong>, ingréselo; la fecha de validación quedará registrada hoy.
            </p>
            <div>
              <label htmlFor="factura-input" className="block text-sm font-medium text-gray-700 mb-1"># Factura <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input id="factura-input" type="text" value={facturaInput} onChange={e => setFacturaInput(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))} autoFocus placeholder="Alfanumérico" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
            </div>
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ UNA VEZ VALIDADO, EL PAGO NO SE PUEDE EDITAR NI ELIMINAR.</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setValidateModal(null); setFacturaInput('') }} disabled={validating} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleValidar} disabled={validating} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">{validating ? 'Validando…' : 'Validar Pago'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar pago pendiente */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">✏️ Editar {editModal.numCuota === 0 ? 'Inscripción' : 'Pago'}</h3>
              <button type="button" onClick={() => setEditModal(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">Editando el pago de <strong>{editModal.titular}</strong>{editModal.numCuota != null ? (editModal.numCuota === 0 ? ' (inscripción)' : ` (cuota ${editModal.numCuota})`) : ''}.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-fechaPago" className="block text-sm font-medium text-gray-700 mb-1">Fecha de Pago</label>
                <input id="edit-fechaPago" type="date" value={editForm.fechaPago} onChange={e => setEditForm(f => ({ ...f, fechaPago: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div>
                <label htmlFor="edit-numCuota" className="block text-sm font-medium text-gray-700 mb-1"># Cuota</label>
                <input id="edit-numCuota" type="number" min={0} value={editForm.numCuota} onChange={e => setEditForm(f => ({ ...f, numCuota: e.target.value.replace(/[^0-9]/g, '') }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div>
                <label htmlFor="edit-valorPagado" className="block text-sm font-medium text-gray-700 mb-1">Valor Pagado</label>
                <input id="edit-valorPagado" type="number" min={0} value={editForm.valorPagado} onChange={e => setEditForm(f => ({ ...f, valorPagado: e.target.value.replace(/[^0-9.]/g, '') }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div>
                <label htmlFor="edit-descuento" className="block text-sm font-medium text-gray-700 mb-1">Descuento</label>
                <input id="edit-descuento" type="number" min={0} value={editForm.descuento} onChange={e => setEditForm(f => ({ ...f, descuento: e.target.value.replace(/[^0-9.]/g, '') }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
              </div>
              <div>
                <label htmlFor="edit-medioPago" className="block text-sm font-medium text-gray-700 mb-1">Medio de Pago</label>
                <select id="edit-medioPago" value={editForm.medioPago} onChange={e => setEditForm(f => ({ ...f, medioPago: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-purple-500 focus:border-purple-500">
                  <option value="">— Seleccione —</option>
                  {editForm.medioPago && !editMedios.includes(editForm.medioPago) && <option value={editForm.medioPago}>{editForm.medioPago}</option>}
                  {editMedios.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="edit-numeroReferencia" className="block text-sm font-medium text-gray-700 mb-1"># Referencia</label>
                <input id="edit-numeroReferencia" type="text" value={editForm.numeroReferencia} onChange={e => setEditForm(f => ({ ...f, numeroReferencia: e.target.value.replace(/[^A-Za-z0-9\-]/g, '') }))} placeholder="Alfanumérico" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
              </div>
            </div>
            <p className="text-xs text-gray-500">El saldo se recalcula automáticamente. Solo se pueden editar pagos <strong>pendientes</strong> (no validados).</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditModal(null)} disabled={editing} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleEditar} disabled={editing} className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50">{editing ? 'Guardando…' : 'Guardar Cambios'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal aprobación masiva */}
      {bulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">✅ Aprobar {selectedCount} {cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'}</h3>
              <button type="button" onClick={() => !bulkValidating && setBulkModal(false)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Se validarán <strong>{selectedCount}</strong> {cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'} seleccionado(s).
              La fecha de validación quedará registrada hoy. El # de factura es opcional y se aplica a todos.
            </p>
            <div>
              <label htmlFor="bulk-factura" className="block text-sm font-medium text-gray-700 mb-1"># Factura <span className="text-gray-400 font-normal">(opcional, para todos)</span></label>
              <input id="bulk-factura" type="text" value={bulkFactura}
                onChange={e => setBulkFactura(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))}
                placeholder="Alfanumérico" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
            </div>
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ UNA VEZ VALIDADOS, LOS PAGOS NO SE PUEDEN EDITAR NI ELIMINAR.</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setBulkModal(false)} disabled={bulkValidating} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleBulkValidar} disabled={bulkValidating} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{bulkValidating ? 'Validando…' : `Aprobar ${selectedCount}`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal documentos */}
      {docsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">📎 Documentos del pago</h3>
              <button type="button" onClick={() => setDocsModal(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">{docsModal.titular}{docsModal.numCuota != null ? ` · ${docsModal.numCuota === 0 ? 'inscripción' : `cuota ${docsModal.numCuota}`}` : ''} — {docsModal.docs.length} documento(s).</p>
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
              {docsModal.docs.map((d, idx) => (
                <li key={idx} className="border border-gray-200 rounded-lg p-2">
                  {(d.tipo || '').startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.url} alt={d.nombre || `doc-${idx}`} className="max-h-48 rounded mb-2" />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600 truncate">{d.nombre || `Documento ${idx + 1}`}</span>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline whitespace-nowrap">
                      Abrir <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
