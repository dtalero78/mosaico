'use client'

import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import { ComercialPermission, PersonPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { User, Filter, Download, ChevronLeft, ChevronRight, AlertCircle, Trash2, X, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import DocumentosReciboModal from '@/components/common/DocumentosReciboModal'

/**
 * Comercial › Matrículas — traída de LGS. Consulta de todos los contratos con
 * filtros, Excel, borrado de matrículas SIN FIRMAR y acceso al Resumen de cada una.
 *
 * Diferencias con LGS:
 *  - Estados de MOSAICO (Devuelto, Retractado, Contrato nulo, Finalizado y
 *    "Listo para aprobar", que es el firmado con el cupo ya tomado).
 *  - Filtro y columna de Campaña/Curso (viven en los beneficiarios).
 *  - Sin la pestaña "En Gestión": ya existe, con la regla de MOSAICO, en
 *    Comercial › Gestión Contrato.
 *  - Borrar pide motivo y NO borra accesos por correo (ver el endpoint).
 *  - Un líder comercial ve sólo los contratos de su equipo.
 */

interface Matricula {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  contrato: string
  celular: string
  email: string
  plataforma: string
  aprobacion?: string
  firmado: boolean
  listo: boolean
  asesor?: string
  liderComercial?: string
  _createdDate: string
  fechaContrato?: string
  finalContrato?: string
  numBeneficiarios?: number
  campanias?: string | null
  cursos?: string | null
  categoria?: string
}

interface FilterState {
  categoria: string
  plataforma: string
  campaign: string
  asesor: string
  contrato: string
  fechaInicio: string
  fechaFin: string
}

// Default = Aprobados, igual que en LGS.
const ESTADOS = [
  { value: 'Aprobados', label: 'Aprobados' },
  { value: '', label: 'Todos los contratos' },
  { value: 'Sin firmar', label: 'Sin firmar' },
  { value: 'Firmado sin aprobar', label: 'Firmado sin aprobar' },
  { value: 'Listo para aprobar', label: 'Listo para aprobar' },
  { value: 'Pendiente', label: 'Pendiente' },
  { value: 'Devuelto', label: 'Devuelto' },
  { value: 'Rechazado', label: 'Rechazado' },
  { value: 'Retractado', label: 'Retractado' },
  { value: 'Contrato nulo', label: 'Contrato nulo' },
  { value: 'Finalizado', label: 'Finalizado' },
]

const RECORDS_PER_PAGE = 10

function categoriaBadge(cat?: string) {
  switch (cat) {
    case 'Aprobados': return 'bg-green-100 text-green-800'
    case 'Listo para aprobar': return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    case 'Firmado sin aprobar': return 'bg-orange-100 text-orange-800'
    case 'Sin firmar': return 'bg-gray-200 text-gray-700'
    case 'Pendiente': return 'bg-yellow-100 text-yellow-800'
    case 'Devuelto': return 'bg-blue-100 text-blue-800'
    case 'Rechazado':
    case 'Retractado':
    case 'Contrato nulo': return 'bg-red-100 text-red-800'
    case 'Finalizado': return 'bg-slate-200 text-slate-700'
    default: return 'bg-gray-100 text-gray-800'
  }
}

// Las fechas del contrato son DATE puras ('YYYY-MM-DD'): se pintan sin pasar por
// la zona del navegador, que en Chile o Colombia las correría un día.
const fmtDate = (v?: string | null) => {
  if (!v) return ''
  const [y, m, d] = String(v).slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : ''
}
const puedeBorrar = (m: Matricula) => m.categoria === 'Sin firmar'
const nombreCompleto = (c: Matricula) => `${c.primerNombre || ''} ${c.primerApellido || ''}`.trim()

export default function MatriculasPage() {
  const { hasPermission } = usePermissions()
  const canDelete = hasPermission(ComercialPermission.MATRICULAS_BORRAR)
  const canDetalle = hasPermission(ComercialPermission.MATRICULAS_DETALLE) || hasPermission(PersonPermission.RESUMEN)

  const [all, setAll] = useState<Matricula[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterState>({ categoria: 'Aprobados', plataforma: '', campaign: '', asesor: '', contrato: '', fechaInicio: '', fechaFin: '' })
  const [currentPage, setCurrentPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [docModal, setDocModal] = useState<Matricula | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/postgres/matriculas', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) toast.error(j?.error || 'No se pudo cargar la lista')
      setAll(j?.success && j.matriculas ? j.matriculas : [])
    } catch { setAll([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    let data = [...all]
    if (search.trim()) {
      const t = search.toLowerCase().trim()
      data = data.filter(c => `${c.primerApellido || ''} ${c.segundoApellido || ''} ${c.primerNombre || ''} ${c.numeroId || ''}`.toLowerCase().includes(t))
    }
    if (filters.categoria) data = data.filter(c => c.categoria === filters.categoria)
    if (filters.plataforma) { const p = filters.plataforma.toLowerCase().trim(); data = data.filter(c => (c.plataforma || '').toLowerCase().trim() === p) }
    if (filters.campaign) data = data.filter(c => (c.campanias || '').split(', ').includes(filters.campaign))
    if (filters.asesor.trim()) { const a = filters.asesor.toLowerCase().trim(); data = data.filter(c => (c.asesor || '').toLowerCase().includes(a)) }
    if (filters.contrato.trim()) { const n = filters.contrato.toLowerCase().trim(); data = data.filter(c => (c.contrato || '').toLowerCase().includes(n)) }
    // Comparación de strings 'YYYY-MM-DD': no depende de la zona del navegador.
    if (filters.fechaInicio) data = data.filter(c => (c.fechaContrato || '') >= filters.fechaInicio)
    if (filters.fechaFin) data = data.filter(c => (c.fechaContrato || '') <= filters.fechaFin)
    return data
  }, [all, search, filters])

  useEffect(() => { setCurrentPage(1); setSelected(new Set()) }, [all, search, filters])

  const totalPages = Math.ceil(filtered.length / RECORDS_PER_PAGE)
  const rows = filtered.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE)
  const changePage = (p: number) => { if (p >= 1 && p <= totalPages) setCurrentPage(p) }

  // La columna "Documentos" aparece si hay algún contrato firmado sin aprobar.
  const showDocsCol = filtered.some(c => c.categoria === 'Firmado sin aprobar' || c.categoria === 'Listo para aprobar')
  const plataformaOptions = useMemo(() => Array.from(new Set(all.map(c => (c.plataforma || '').trim()).filter(Boolean))).sort(), [all])
  const campaignOptions = useMemo(() => Array.from(new Set(all.flatMap(c => (c.campanias || '').split(', ')).filter(Boolean))).sort(), [all])
  const selectedRows = filtered.filter(c => selected.has(c._id) && puedeBorrar(c))

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const doDelete = async () => {
    if (selectedRows.length === 0 || !motivo.trim()) return
    setDeleting(true)
    try {
      const r = await fetch('/api/postgres/matriculas/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRows.map(c => c._id), motivo: motivo.trim() }),
      })
      const j = await r.json()
      if (!r.ok) { toast.error(j?.error || 'Error al borrar'); return }
      const fallos = (j.results || []).filter((x: any) => x.status !== 'ok')
      if (fallos.length) toast.error(`${j.message}\n${fallos.map((f: any) => `${f.contrato}: ${f.error}`).join('\n')}`, { duration: 8000 })
      else toast.success(j?.message || 'Borrado completado')
      setShowModal(false); setSelected(new Set()); setMotivo('')
      await load()
    } catch { toast.error('Error al borrar. Intenta de nuevo.') } finally { setDeleting(false) }
  }

  const abrirResumen = (c: Matricula) => { if (canDetalle) window.open(`/dashboard/comercial/matriculas/${c._id}`, '_blank') }

  return (
    <DashboardLayout>
      <PermissionGuard permission={ComercialPermission.MATRICULAS_VER} showDefaultMessage>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">📋 Matrículas</h1>
              <p className="mt-2 text-sm text-gray-700">Consulta de contratos y borrado de matrículas sin firmar</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <button type="button" onClick={() => exportToExcel(filtered, [
                { header: 'Titular', accessor: (c) => nombreCompleto(c) },
                { header: 'Documento', accessor: (c) => c.numeroId },
                { header: 'Contrato', accessor: (c) => c.contrato },
                { header: 'Plataforma', accessor: (c) => c.plataforma },
                { header: 'Campaña', accessor: (c) => c.campanias || '' },
                { header: 'Curso', accessor: (c) => c.cursos || '' },
                { header: 'Beneficiarios', accessor: (c) => c.numBeneficiarios ?? 0 },
                { header: 'Asesor', accessor: (c) => c.asesor || '' },
                { header: 'Líder comercial', accessor: (c) => c.liderComercial || '' },
                { header: 'Fecha Contrato', accessor: (c) => fmtDate(c.fechaContrato) },
                { header: 'Fin Contrato', accessor: (c) => fmtDate(c.finalContrato) },
                { header: 'Celular', accessor: (c) => c.celular },
                { header: 'Email', accessor: (c) => c.email },
                { header: 'Estado', accessor: (c) => c.categoria || '' },
              ], `matriculas-${new Date().toISOString().split('T')[0]}`)}
                disabled={filtered.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
              <button type="button" onClick={() => load()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2">
                <Filter className="w-4 h-4" /> Actualizar
              </button>
              {canDelete && (
                <button type="button" onClick={() => selectedRows.length > 0 && setShowModal(true)}
                  disabled={selectedRows.length === 0}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 disabled:opacity-50">
                  <Trash2 className="w-4 h-4" /> Borrar matrícula{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
                </button>
              )}
            </div>
          </div>

          {/* Filtros */}
          <div className="card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-3">
                <label htmlFor="q" className="block text-sm font-medium text-gray-700 mb-1">Buscar (nombre o ID)</label>
                <input id="q" type="text" placeholder="Apellido, nombre o documento..." value={search} onChange={e => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="f-asesor" className="block text-sm font-medium text-gray-700 mb-1">Asesor</label>
                <input id="f-asesor" type="text" placeholder="Nombre asesor..." value={filters.asesor} onChange={e => setFilters(p => ({ ...p, asesor: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="f-contrato" className="block text-sm font-medium text-gray-700 mb-1"># Contrato</label>
                <input id="f-contrato" type="text" placeholder="01-M5-..." value={filters.contrato} onChange={e => setFilters(p => ({ ...p, contrato: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="lg:col-span-2">
                <label htmlFor="f-estado" className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select id="f-estado" value={filters.categoria} onChange={e => setFilters(p => ({ ...p, categoria: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
                  {ESTADOS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="f-plat" className="block text-sm font-medium text-gray-700 mb-1">Plataforma</label>
                <select id="f-plat" value={filters.plataforma} onChange={e => setFilters(p => ({ ...p, plataforma: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
                  <option value="">Todas</option>
                  {plataformaOptions.map(p => (<option key={p} value={p}>{p}</option>))}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label htmlFor="f-camp" className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
                <select id="f-camp" value={filters.campaign} onChange={e => setFilters(p => ({ ...p, campaign: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500">
                  <option value="">Todas</option>
                  {campaignOptions.map(p => (<option key={p} value={p}>{p}</option>))}
                </select>
              </div>
              <div className="lg:col-span-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas (fecha de contrato)</label>
                <div className="flex gap-2 max-w-md">
                  <input type="date" aria-label="Desde" value={filters.fechaInicio} onChange={e => setFilters(p => ({ ...p, fechaInicio: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" />
                  <input type="date" aria-label="Hasta" value={filters.fechaFin} onChange={e => setFilters(p => ({ ...p, fechaFin: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Resultados + paginación */}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Registros filtrados ({filtered.length}){canDelete && selectedRows.length > 0 ? ` · ${selectedRows.length} seleccionado(s)` : ''}</h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" title="Anterior" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 1} className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-3 py-1 text-sm">{currentPage} de {totalPages}</span>
                <button type="button" title="Siguiente" onClick={() => changePage(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="card p-12 text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto" /><p className="mt-4 text-gray-600">Cargando...</p></div>
          ) : rows.length === 0 ? (
            <div className="card p-12 text-center"><AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900 mb-2">No hay contratos</h3><p className="text-gray-500">No se encontraron con los filtros aplicados</p></div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {canDelete && <th className="px-4 py-3 w-10"><span className="sr-only">Seleccionar</span></th>}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Titular</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contrato</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaña · Curso</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Contrato</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contacto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fin Contrato</th>
                      {showDocsCol && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Documentos</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {rows.map(c => {
                      const selectable = puedeBorrar(c)
                      return (
                        <tr key={c._id} className="hover:bg-gray-50">
                          {canDelete && (
                            <td className="px-4 py-4">
                              <input type="checkbox" aria-label={`Seleccionar ${c.contrato}`}
                                checked={selected.has(c._id)} disabled={!selectable}
                                onChange={() => toggle(c._id)}
                                title={selectable ? 'Seleccionar para borrar' : 'Sólo se pueden borrar contratos SIN FIRMAR'}
                                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
                            </td>
                          )}
                          <td className={`px-6 py-4 whitespace-nowrap ${canDetalle ? 'cursor-pointer' : ''}`} onClick={() => abrirResumen(c)}
                            title={canDetalle ? 'Ver el resumen de la matrícula' : undefined}>
                            <div className="flex items-center">
                              <div className="h-10 w-10 rounded-full bg-primary-50 flex items-center justify-center"><User className="h-5 w-5 text-primary-600" /></div>
                              <div className="ml-4">
                                <div className={`text-sm font-medium ${canDetalle ? 'text-primary-700 hover:underline' : 'text-gray-900'}`}>{nombreCompleto(c)}</div>
                                <div className="text-sm text-gray-500">{c.numeroId} {c.asesor ? `· ${c.asesor}` : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">{c.contrato}</div><div className="text-sm text-gray-500">{c.plataforma} · {c.numBeneficiarios ?? 0} benef.</div></td>
                          <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">{c.campanias || '—'}</div><div className="text-sm text-gray-500">{c.cursos || ''}</div></td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{fmtDate(c.fechaContrato)}</td>
                          <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">{c.celular}</div><div className="text-sm text-gray-500">{c.email}</div></td>
                          <td className="px-6 py-4 whitespace-nowrap"><span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${categoriaBadge(c.categoria)}`}>{c.categoria || '—'}</span></td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{fmtDate(c.finalContrato)}</td>
                          {showDocsCol && (
                            <td className="px-6 py-4 whitespace-nowrap">
                              {c.categoria === 'Firmado sin aprobar' || c.categoria === 'Listo para aprobar' ? (
                                <button type="button" onClick={() => setDocModal(c)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100">
                                  <FileText className="w-3.5 h-3.5" /> Documentos y recibo
                                </button>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
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
        </div>

        {/* Modal de confirmación de borrado */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[85vh] overflow-auto">
              <div className="flex justify-between items-center p-5 border-b border-red-100 bg-red-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-red-800 flex items-center gap-2"><Trash2 className="w-5 h-5" /> Borrar matrícula(s)</h3>
                <button type="button" onClick={() => setShowModal(false)} title="Cerrar" className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-sm text-gray-700">
                  ⚠️ Esta acción <strong>borra en cascada e irreversiblemente</strong> el contrato: <strong>titular, beneficiarios, ficha académica, clases, financiero, pagos y accesos</strong>. Sólo aplica a contratos <strong>SIN FIRMAR</strong>. Queda una copia completa en la bitácora. Confirma los {selectedRows.length} contrato(s):
                </p>
                <div className="border border-gray-100 rounded-lg divide-y max-h-[35vh] overflow-auto">
                  {selectedRows.map(c => (
                    <div key={c._id} className="px-3 py-2 text-sm">
                      <div className="font-medium text-gray-900">{nombreCompleto(c)} <span className="text-gray-400 font-normal">· {c.numeroId}</span></div>
                      <div className="text-gray-600 text-xs mt-0.5">
                        Contrato <strong>{c.contrato}</strong> · {c.plataforma} · Fecha: {fmtDate(c.fechaContrato)} ·{' '}
                        {c.numBeneficiarios && c.numBeneficiarios > 0
                          ? <span className="text-amber-700">{c.numBeneficiarios} beneficiario(s)</span>
                          : <span className="text-gray-400">sin beneficiarios</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <label htmlFor="motivo-borrado" className="block text-sm font-medium text-gray-700 mb-1">Motivo <span className="text-red-600">*</span></label>
                  <textarea id="motivo-borrado" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Ej.: contrato duplicado, el cliente desistió antes de firmar..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-red-400" />
                </div>
              </div>
              <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancelar</button>
                <button type="button" onClick={doDelete} disabled={deleting || !motivo.trim()} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> {deleting ? 'Borrando...' : `Borrar ${selectedRows.length} matrícula(s)`}
                </button>
              </div>
            </div>
          </div>
        )}

        <DocumentosReciboModal
          open={!!docModal}
          personId={docModal?._id ?? null}
          subtitulo={docModal ? `${nombreCompleto(docModal)} · Contrato ${docModal.contrato}` : ''}
          onClose={() => setDocModal(null)}
        />
      </PermissionGuard>
    </DashboardLayout>
  )
}
