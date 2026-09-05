'use client'

/**
 * Panel reutilizable de validación de pagos (Recaudos).
 *
 * Lo usan dos páginas con la MISMA consulta/acciones, cambiando solo el
 * filtro+columna lateral según `variant`:
 *   - variant='gestor'    → Centro de Validación de Pagos (filtro/columna Gestor de Recaudo)
 *   - variant='medioPago' → Bancos (filtro/columna Medio de Pago)
 *
 * Tres pestañas (pipeline verificar → facturar):
 *   - "Verificación Pago"        → cuotas numCuota>0 pendientes de verificar
 *   - "Verificación Inscripción" → cuota #0 pendiente de verificar
 *   - "Facturación"              → verificados (validado=true) SIN número de
 *                                   factura (pagos + inscripciones). Aquí se
 *                                   captura el # de factura.
 * Al "Validar" ya NO se pide factura: el pago pasa a Facturación, donde el
 * modal pide el número de factura.
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
  pagoTercero: string | null
  idTercero: string | null
  gestorRecaudo: string | null
  medioPago: string | null
  titular_primerNombre: string
  titular_primerApellido: string
  titular_segundoApellido: string | null
  titular_numeroId: string
  titular_contrato: string | null
  titular_plataforma: string | null
  titular_asesorNombre: string | null
  documentosAdjuntos: DocAdjunto[] | null
}

interface DisplayUser { _id: string; email: string; nombre: string; rol: string }

type Variant = 'gestor' | 'medioPago'
type Tab = 'pago' | 'inscripcion' | 'facturacion'

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
  const canFacturar = hasPermission(PersonPermission.PAGOS_FACTURAR)
  // Ver documentos adjuntos — gateado para poder definir usuarios de solo consulta.
  const canVerDocs = hasPermission(PersonPermission.PAGOS_VER)
  // Aprobación EN BLOQUE — gateada por rol (permiso propio).
  const canAprobarMasivo = hasPermission(RecaudosPermission.APROBACION_MASIVA)

  const isGestor = variant === 'gestor'
  const lateralLabel = isGestor ? 'Gestor de Recaudo' : 'Medio de Pago'

  // Pestaña (pipeline): Verificación Pago | Verificación Inscripción | Facturación
  const [tab, setTab] = useState<Tab>('pago')
  const cuotaTipo = tab === 'inscripcion' ? 'inscripcion' : 'regular'
  const isFacturacion = tab === 'facturacion'

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
  const [validating, setValidating] = useState(false)
  const [docsModal, setDocsModal] = useState<{ titular: string; numCuota: number | null; docs: DocAdjunto[] } | null>(null)

  // Modal Facturar (pestaña Facturación)
  const [facturarModal, setFacturarModal] = useState<{ id: string; idPeople: string; numCuota: number | null; titular: string } | null>(null)
  const [facturaInput, setFacturaInput] = useState('')
  const [facturaFile, setFacturaFile] = useState<DocAdjunto | null>(null)
  const [subiendoFactura, setSubiendoFactura] = useState(false)
  const [facturando, setFacturando] = useState(false)

  // Edición de pago pendiente
  const [editModal, setEditModal] = useState<{ id: string; titular: string; numCuota: number | null } | null>(null)
  const [editForm, setEditForm] = useState({ fechaPago: '', valorPagado: '', descuento: '', medioPago: '', numeroReferencia: '', numCuota: '' })
  const [editing, setEditing] = useState(false)

  // Selección para aprobación masiva
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkValidating, setBulkValidating] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchPagos = useCallback(async (resetPage = false) => {
    setLoading(true)
    try {
      const pageToUse = resetPage ? 1 : page
      const qs = new URLSearchParams()
      if (isFacturacion) {
        qs.set('vista', 'facturacion')
      } else {
        qs.set('cuotaTipo', cuotaTipo)
        if (estado) qs.set('estado', estado)
      }
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
  }, [tab, cuotaTipo, isFacturacion, estado, search, fechaInicio, fechaFin, isGestor, gestorFiltro, medioFiltro, plataformaFiltro, page])

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
  useEffect(() => { fetchPagos(true) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab])

  const handleAplicarFiltros = () => fetchPagos(true)
  const handleLimpiar = () => {
    setEstado('pendiente'); setSearch(''); setFechaInicio(''); setFechaFin(''); setGestorFiltro(''); setMedioFiltro(''); setPlataformaFiltro('')
    setTimeout(() => fetchPagos(true), 0)
  }

  const openValidar = (p: PagoRow) => {
    setValidateModal({ id: p._id, numCuota: p.numCuota, titular: `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim(), medioPago: p.medioPago })
  }

  // Validar = VERIFICAR (ya NO pide factura). El pago pasa a Facturación.
  const handleValidar = async () => {
    if (!validateModal) return
    setValidating(true)
    try {
      await api.post(`/api/postgres/pagos-titulares/${validateModal.id}/validar`, { fechaValidacion: getLocalToday() })
      toast.success(validateModal.numCuota === 0 ? 'Inscripción verificada → pasa a Facturación' : 'Pago verificado → pasa a Facturación')
      setValidateModal(null)
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error al verificar el pago')
    } finally {
      setValidating(false)
    }
  }

  // ── Facturar (pestaña Facturación): registra el # de factura + adjunta el archivo ──
  const openFacturar = (p: PagoRow) => {
    setFacturaInput(''); setFacturaFile(null)
    setFacturarModal({ id: p._id, idPeople: p.idPeople, numCuota: p.numCuota, titular: `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim() })
  }
  // Sube el archivo de la factura a Spaces (mismo flujo que los documentos del pago).
  const subirFacturaArchivo = async (file: File) => {
    if (!facturarModal) return
    setSubiendoFactura(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/contracts/${facturarModal.idPeople}/upload-url`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any))
        throw new Error(err.details || err.error || `Error ${res.status}`)
      }
      const { publicUrl } = await res.json()
      setFacturaFile({ url: publicUrl, nombre: file.name, tipo: file.type, fechaSubida: new Date().toISOString() })
      toast.success('Archivo de factura adjuntado')
    } catch (e: any) {
      toast.error(`Error subiendo el archivo: ${e?.message || ''}`)
    } finally {
      setSubiendoFactura(false)
    }
  }
  const pickFacturaArchivo = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,application/pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (f) subirFacturaArchivo(f)
      document.body.removeChild(input)
    })
    input.click()
  }
  const handleFacturar = async () => {
    if (!facturarModal) return
    const factura = facturaInput.trim()
    if (!factura) { toast.error('El número de factura es obligatorio'); return }
    setFacturando(true)
    try {
      await api.post(`/api/postgres/pagos-titulares/${facturarModal.id}/facturar`, {
        numeroFactura: factura,
        documento: facturaFile ? { url: facturaFile.url, nombre: `Factura ${factura} — ${facturaFile.nombre || ''}`.trim(), tipo: facturaFile.tipo } : null,
      })
      toast.success(`Factura ${factura} registrada${facturaFile ? ' con archivo adjunto' : ''}`)
      setFacturarModal(null); setFacturaInput(''); setFacturaFile(null)
      fetchPagos()
    } catch (err) {
      handleApiError(err, 'Error al registrar la factura')
    } finally {
      setFacturando(false)
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

  // ── Aprobación masiva (solo en las pestañas de Verificación) ────────────
  const showBulk = canAprobarMasivo && !isFacturacion
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
        { ids, numeroFactura: '', fechaValidacion: getLocalToday() }
      )
      const noun = cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'
      toast.success(`${r.ok} ${noun} verificado(s)${r.fail ? ` · ${r.fail} con error` : ''}`)
      setBulkModal(false)
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
    const gr = (p.gestorRecaudo || '').toLowerCase()
    const g = displayUsers.find(u => u._id === p.gestorRecaudo) || displayUsers.find(u => (u.email || '').toLowerCase() === gr)
    // Fallback: en inscripciones el gestor es el asesor (email) → nombre del creador del contrato.
    return g?.nombre || (p.titular_asesorNombre && p.titular_asesorNombre.trim()) || p.gestorRecaudo || ''
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
      '# Referencia': p.numeroReferencia || '',
      'Pago Tercero': p.pagoTercero || '',
      [lateralLabel]: isGestor ? gestorNombre(p) : (p.medioPago || ''),
      Validado: p.validado ? 'Sí' : 'No',
      'Fecha Validación': fmtDate(p.fechaValidacion),
      'Validado por': p.validadoPor || '',
      '# Factura': p.numeroFactura || '',
      Plataforma: p.titular_plataforma || '',
    }))
    const columns = (Object.keys(rows[0]) as Array<keyof typeof rows[0]>).map(k => ({ header: String(k), accessor: (row: typeof rows[0]) => row[k] as any }))
    const fileBase = isGestor ? 'centro-validacion-pagos' : 'bancos'
    exportToExcel(rows, columns, `${fileBase}-${isFacturacion ? 'facturacion' : cuotaTipo}-${getLocalToday()}.csv`)
  }

  const countLabel = isFacturacion ? 'Facturación' : cuotaTipo === 'inscripcion' ? 'Inscripciones' : 'Pagos'

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

      {/* Pestañas (pipeline: verificar → facturar) */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'pago', label: 'Verificación Pago' },
          { key: 'inscripcion', label: 'Verificación Inscripción' },
          { key: 'facturacion', label: 'Facturación' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.key ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}`}>
            {t.label}
          </button>
        ))}
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
          <select id="estado" value={isFacturacion ? '' : estado} onChange={e => setEstado(e.target.value as any)} disabled={isFacturacion}
            title={isFacturacion ? 'En Facturación se muestran los pagos verificados sin factura' : undefined}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:text-gray-400">
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

        {/* Barra de aprobación masiva (solo con permiso + selección, en Verificación) */}
        {showBulk && selectedCount > 0 && (
          <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-emerald-900">{selectedCount} seleccionado(s)</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 text-xs text-gray-700 border border-gray-300 rounded-md bg-white hover:bg-gray-50">Limpiar</button>
              <button type="button" onClick={() => setBulkModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700">
                <CheckBadgeIcon className="h-4 w-4" /> Verificar seleccionados
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="p-6 text-sm text-gray-400 italic text-center">Cargando…</p>
        ) : pagos.length === 0 ? (
          <p className="p-6 text-sm text-gray-400 italic text-center">No hay {isFacturacion ? 'pagos por facturar' : countLabel.toLowerCase()} con los filtros seleccionados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="whitespace-nowrap text-xs uppercase tracking-wide">
                  {showBulk && (
                    <th className="px-2 py-2 w-8 text-center">
                      <input type="checkbox" aria-label="Seleccionar todos los pendientes"
                        title="Seleccionar todos los pendientes de esta página"
                        checked={allPendingSelected} disabled={pendientes.length === 0}
                        onChange={toggleAllPending} />
                    </th>
                  )}
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Titular</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Contrato</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">Fecha</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-600">Valor</th>
                  <th className="px-2 py-2 text-center font-medium text-gray-600">Cuota</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600"># Ref.</th>
                  <th className="px-2 py-2 text-left font-medium text-gray-600">{lateralLabel}</th>
                  <th className="px-2 py-2 text-right font-medium text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagos.map(p => {
                  const titularNombre = `${p.titular_primerNombre} ${p.titular_primerApellido}`.trim()
                  const gr = (p.gestorRecaudo || '').toLowerCase()
                  const g = displayUsers.find(u => u._id === p.gestorRecaudo) || displayUsers.find(u => (u.email || '').toLowerCase() === gr)
                  return (
                    <tr key={p._id} className={`hover:bg-gray-50 ${selected.has(p._id) ? 'bg-emerald-50/40' : ''}`}>
                      {showBulk && (
                        <td className="px-2 py-2 text-center align-top">
                          {!p.validado ? (
                            <input type="checkbox" aria-label={`Seleccionar pago de ${p.titular_primerNombre}`}
                              checked={selected.has(p._id)} onChange={() => toggleOne(p._id)} />
                          ) : (
                            <CheckBadgeIcon className="h-4 w-4 text-emerald-500 mx-auto" />
                          )}
                        </td>
                      )}
                      <td className="px-2 py-2 align-top">
                        <Link href={`/person/${p.idPeople}?tab=financiera`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                          {titularNombre || '—'}
                        </Link>
                        <div className="text-[11px] text-gray-500">ID {p.titular_numeroId}</div>
                      </td>
                      <td className="px-2 py-2 text-gray-700 align-top whitespace-nowrap">
                        <div>{p.titular_contrato || '—'}</div>
                        {p.pagoTercero && p.pagoTercero.trim() && (
                          <span title={`Pago realizado por: ${p.pagoTercero}${p.idTercero ? ` (ID ${p.idTercero})` : ''}`}
                            className="mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800">
                            Pago tercero
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-gray-900 align-top whitespace-nowrap">{fmtDate(p.fechaPago)}</td>
                      <td className="px-2 py-2 text-right text-gray-900 font-medium align-top whitespace-nowrap">{p.valorPagado ? formatCurrency(p.valorPagado) : '—'}</td>
                      <td className="px-2 py-2 text-center text-gray-900 font-medium align-top whitespace-nowrap">{p.numCuota === 0 ? 'Insc.' : (p.numCuota ?? '—')}</td>
                      <td className="px-2 py-2 text-gray-700 text-xs align-top">
                        <span className="block max-w-[90px] truncate" title={p.numeroReferencia || ''}>{p.numeroReferencia || '—'}</span>
                      </td>
                      <td className="px-2 py-2 text-gray-700 align-top">
                        {isGestor ? (
                          g ? (
                            <div className="flex items-start gap-1">
                              <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800 shrink-0">{ROLE_LABEL[g.rol] || g.rol}</span>
                              <span className="text-xs max-w-[110px] truncate" title={g.nombre}>{g.nombre}</span>
                            </div>
                          ) : p.titular_asesorNombre && p.titular_asesorNombre.trim() ? (
                            // Inscripciones: el gestor guardado es el asesor (email) que creó
                            // el contrato → mostramos su NOMBRE (PEOPLE.asesorCreadorContrato).
                            <div className="flex items-start gap-1">
                              <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800 shrink-0">Comercial</span>
                              <span className="text-xs max-w-[110px] truncate" title={`${p.titular_asesorNombre}${p.gestorRecaudo ? ` · ${p.gestorRecaudo}` : ''}`}>{p.titular_asesorNombre}</span>
                            </div>
                          ) : <span className="text-xs text-gray-400 italic">{p.gestorRecaudo || '—'}</span>
                        ) : (
                          <span className="text-xs">{p.medioPago || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                          {canVerDocs && Array.isArray(p.documentosAdjuntos) && p.documentosAdjuntos.length > 0 && (
                            <button type="button" onClick={() => setDocsModal({ titular: titularNombre, numCuota: p.numCuota, docs: p.documentosAdjuntos as DocAdjunto[] })}
                              title={`Ver ${p.documentosAdjuntos.length} documento(s) del pago`} className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200">
                              <PaperClipIcon className="h-3.5 w-3.5" /> {p.documentosAdjuntos.length}
                            </button>
                          )}
                          {/* Verificación: Editar + Validar (pendientes) */}
                          {!isFacturacion && !p.validado && canEditar && (
                            <button type="button" onClick={() => openEditar(p)} title="Editar pago" className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-white bg-amber-500 rounded hover:bg-amber-600">
                              <PencilSquareIcon className="h-3.5 w-3.5" /> Editar
                            </button>
                          )}
                          {!isFacturacion && !p.validado && canValidar && (
                            <button type="button" onClick={() => openValidar(p)} title="Verificar pago (pasa a Facturación)" className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700">
                              <CheckBadgeIcon className="h-3.5 w-3.5" /> Validar
                            </button>
                          )}
                          {/* Facturación: Facturar (registra # factura) */}
                          {isFacturacion && canFacturar && (
                            <button type="button" onClick={() => openFacturar(p)} title="Registrar número de factura" className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-white bg-purple-600 rounded hover:bg-purple-700">
                              <DocumentTextIcon className="h-3.5 w-3.5" /> Facturar
                            </button>
                          )}
                          {p.validado && canRecibo && (
                            <button type="button" onClick={() => handleGenerarRecibo(p._id)} title={p.numeroRecibo ? `Descargar recibo ${p.numeroRecibo}` : 'Generar recibo de pago'} className="inline-flex items-center gap-0.5 px-1.5 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">
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

      {/* Modal validar (verificar → pasa a Facturación) */}
      {validateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">✅ Verificar {validateModal.numCuota === 0 ? 'Inscripción' : 'Pago'}</h3>
              <button type="button" onClick={() => setValidateModal(null)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Confirme la verificación del pago{validateModal.numCuota != null ? (validateModal.numCuota === 0 ? ' (inscripción)' : ` (cuota ${validateModal.numCuota})`) : ''}
              {' '}de <strong>{validateModal.titular}</strong>
              {validateModal.medioPago ? <>, con el medio de pago <strong>{validateModal.medioPago}</strong></> : ''}.
              {' '}La fecha de validación quedará registrada hoy y el pago pasará a la pestaña <strong>Facturación</strong>, donde se registrará el número de factura.
            </p>
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ UNA VEZ VERIFICADO, EL PAGO NO SE PUEDE EDITAR NI ELIMINAR.</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setValidateModal(null)} disabled={validating} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleValidar} disabled={validating} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">{validating ? 'Verificando…' : 'Verificar Pago'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal facturar (registra # de factura del pago verificado) */}
      {facturarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">🧾 Facturar {facturarModal.numCuota === 0 ? 'Inscripción' : 'Pago'}</h3>
              <button type="button" onClick={() => { setFacturarModal(null); setFacturaInput(''); setFacturaFile(null) }} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Registre el <strong>número de factura</strong> del pago{facturarModal.numCuota != null ? (facturarModal.numCuota === 0 ? ' (inscripción)' : ` (cuota ${facturarModal.numCuota})`) : ''}
              {' '}de <strong>{facturarModal.titular}</strong>. Al facturar, el registro sale de esta cola.
            </p>
            <div>
              <label htmlFor="facturar-input" className="block text-sm font-medium text-gray-700 mb-1"># Factura <span className="text-red-500">*</span></label>
              <input id="facturar-input" type="text" value={facturaInput} onChange={e => setFacturaInput(e.target.value.replace(/[^A-Za-z0-9\-]/g, ''))} autoFocus placeholder="Alfanumérico" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-purple-500 focus:border-purple-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Archivo de la factura <span className="text-gray-400 font-normal">(opcional)</span></label>
                <button type="button" onClick={pickFacturaArchivo} disabled={subiendoFactura || facturando}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700 disabled:opacity-50">
                  <PaperClipIcon className="h-4 w-4" /> {subiendoFactura ? 'Subiendo…' : 'Adjuntar'}
                </button>
              </div>
              {facturaFile ? (
                <div className="flex items-center justify-between gap-2 border border-gray-200 rounded-md px-2 py-1.5 bg-gray-50">
                  <span className="text-xs text-gray-700 truncate" title={facturaFile.nombre || ''}>📎 {facturaFile.nombre || 'archivo'}</span>
                  <button type="button" onClick={() => setFacturaFile(null)} disabled={facturando} title="Quitar archivo" className="text-gray-400 hover:text-red-600"><XMarkIcon className="h-4 w-4" /></button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Sin archivo adjunto (JPG, PNG, WEBP, HEIC o PDF · máx 20MB).</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setFacturarModal(null); setFacturaInput(''); setFacturaFile(null) }} disabled={facturando} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleFacturar} disabled={facturando || subiendoFactura || !facturaInput.trim()} className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">{facturando ? 'Registrando…' : 'Registrar Factura'}</button>
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
              <h3 className="text-lg font-bold text-gray-900">✅ Verificar {selectedCount} {cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'}</h3>
              <button type="button" onClick={() => !bulkValidating && setBulkModal(false)} title="Cerrar" className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-gray-600">
              Se verificarán <strong>{selectedCount}</strong> {cuotaTipo === 'inscripcion' ? 'inscripción(es)' : 'pago(s)'} seleccionado(s).
              La fecha de validación quedará registrada hoy y pasarán a la pestaña <strong>Facturación</strong>.
            </p>
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ UNA VEZ VERIFICADOS, LOS PAGOS NO SE PUEDEN EDITAR NI ELIMINAR.</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setBulkModal(false)} disabled={bulkValidating} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={handleBulkValidar} disabled={bulkValidating} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">{bulkValidating ? 'Verificando…' : `Verificar ${selectedCount}`}</button>
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
