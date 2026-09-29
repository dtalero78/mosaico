'use client'

import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions'
import { AprobacionPermission } from '@/types/permissions'
import { Download, Filter, ChevronLeft, ChevronRight, User, AlertCircle, CheckCircle } from 'lucide-react'
import { exportToExcel } from '@/lib/export-excel'
import type { EstadoCurso } from '@/lib/cursos-campaign'

interface Contrato {
  _id: string
  primerNombre: string
  primerApellido: string
  segundoApellido?: string
  numeroId: string
  contrato: string
  campaign?: string
  /** Campaña de la que salió el alumno al soltar el cupo (sólo si hoy no tiene). */
  campaignAnterior?: string
  celular: string
  email: string
  plataforma: string
  aprobacion?: string
  estado?: string
  estadoInactivo?: boolean
  finalContrato?: string
  _createdDate: Date
}

const RECORDS_PER_PAGE = 10

/**
 * Estado consolidado del contrato (Finalizado > Inactivo > Aprobado).
 *
 * En la vista "Sin aprobar" no aplica: ahí ninguno está aprobado, así que se
 * muestra su decisión real (Devuelto, Retractado, Contrato nulo, Pendiente…).
 */
function estadoDe(c: Contrato): { key: 'Finalizado' | 'Inactivo' | 'Aprobado'; text: string; color: string } {
  if (c.aprobacion === 'FINALIZADA' || c.estado === 'FINALIZADA') {
    return { key: 'Finalizado', text: 'Finalizado', color: 'bg-red-100 text-red-800' }
  }
  if (c.estadoInactivo === true) {
    return { key: 'Inactivo', text: 'Inactivo', color: 'bg-gray-200 text-gray-800' }
  }
  return { key: 'Aprobado', text: 'Aprobado', color: 'bg-green-100 text-green-800' }
}

/** Distintivo de un contrato sin aprobar: su propia decisión, o "Sin decisión". */
function estadoSinAprobar(c: Contrato): { text: string; color: string } {
  const v = (c.aprobacion || '').trim()
  if (!v) return { text: 'Sin decisión', color: 'bg-amber-100 text-amber-800' }
  const rojos = ['Rechazado', 'Contrato nulo', 'Retractado']
  return {
    text: v,
    color: rojos.includes(v) ? 'bg-red-100 text-red-800'
      : v === 'Devuelto' ? 'bg-blue-100 text-blue-800'
      : 'bg-amber-100 text-amber-800',
  }
}

/** El valor que cambia el UNIVERSO consultado, no el filtro sobre lo ya traído. */
const SIN_APROBAR = 'SIN_APROBAR'

const ESTADOS = [
  { value: '', label: 'Todos (aprobados/inactivos/finalizados)' },
  { value: 'Aprobado', label: 'Aprobado' },
  { value: 'Inactivo', label: 'Inactivo' },
  { value: 'Finalizado', label: 'Finalizado' },
  { value: SIN_APROBAR, label: 'Sin aprobar (firmados)' },
]

/** Valor del desplegable para los contratos que no tienen campaña. */
const SIN_CAMPANA = '__SIN_CAMPANA__'

type Tab = 'recientes' | 'global'

interface Campana { campaign: string; estado: EstadoCurso; inicio: string }

/** El estado dicho de una campaña (el de `ESTADO_CURSO_META` está en masculino: es de un curso). */
const ESTADO_CAMPANA: Record<EstadoCurso, string> = {
  matricula: 'en matrícula',
  activo: 'activa',
  cerrado: 'cerrada',
}

/** La campaña con la que se busca el contrato: la de hoy o, si soltó el cupo, la anterior. */
const campanaDe = (c: Contrato) => c.campaign || c.campaignAnterior || ''

export default function AprobadosPage() {
  // Las dos pestañas son la MISMA pantalla con los mismos filtros; sólo cambia
  // el alcance. Recientes: la campaña en matrícula y la activa más reciente.
  // Global: todas las campañas, y los contratos que no tienen ninguna.
  const [tab, setTab] = useState<Tab>('recientes')
  const esGlobal = tab === 'global'
  const [all, setAll] = useState<Contrato[]>([])
  const [campanias, setCampanias] = useState<Campana[]>([])
  const [recientes, setRecientes] = useState<string[]>([])
  const [rows, setRows] = useState<Contrato[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('')
  const [campaign, setCampaign] = useState('')
  const [fechaInicio, setFechaInicio] = useState<Date | null>(null)
  const [fechaFin, setFechaFin] = useState<Date | null>(null)
  const [page, setPage] = useState(1)

  // "Sin aprobar" no filtra lo ya traído: consulta OTRO universo (firmados que
  // nadie aprobó), así que al elegirlo se vuelve a pedir la lista al servidor.
  const verSinAprobar = estado === SIN_APROBAR

  // Sólo se pinta la última consulta pedida: una respuesta vieja que llegue
  // después pisaría los datos de la nueva.
  const reqRef = useRef(0)
  const load = async (sinAprobar = verSinAprobar) => {
    const req = ++reqRef.current
    setLoading(true)
    try {
      const url = `/api/postgres/approvals/aprobados${sinAprobar ? '?vista=sin-aprobar' : ''}`
      const r = await fetch(url, { cache: 'no-store' }).then(x => x.json())
      if (req !== reqRef.current) return
      setAll(r.success && r.approvals ? r.approvals : [])
      setCampanias(Array.isArray(r.campanias) ? r.campanias : [])
      setRecientes(Array.isArray(r.recientes) ? r.recientes : [])
    } catch { if (req === reqRef.current) setAll([]) } finally { if (req === reqRef.current) setLoading(false) }
  }
  useEffect(() => { load(verSinAprobar) }, [verSinAprobar])

  // Campañas que ofrece el desplegable de cada pestaña. Recientes: sus dos
  // campañas. Global: el catálogo completo (la más reciente primero) y, al
  // final, las que aparezcan en los contratos y ya no estén en el catálogo.
  const enCatalogo = campanias.map(c => c.campaign)
  const campaignOptions = esGlobal
    ? [
        ...enCatalogo,
        ...(Array.from(new Set(all.map(campanaDe).filter(c => c && !enCatalogo.includes(c)))).sort()),
      ]
    : recientes
  const estadoCampana = (nombre: string) => campanias.find(c => c.campaign === nombre)?.estado

  // Los filtros se conservan al cambiar de pestaña; sólo se suelta la campaña
  // elegida cuando la otra pestaña no la ofrece.
  const cambiarTab = (t: Tab) => {
    if (t === tab) return
    if (t === 'recientes' && campaign && !recientes.includes(campaign)) setCampaign('')
    setTab(t)
  }

  const filtered = (): Contrato[] => {
    let d = [...all]
    // Alcance de la pestaña. Sin campañas recientes resueltas no se esconde
    // nada: el vacío es "todavía no sé", no "no hay ninguna".
    if (!esGlobal && recientes.length) d = d.filter(c => recientes.includes(campanaDe(c)))
    if (search.trim()) {
      const s = search.toLowerCase().trim()
      d = d.filter(c => `${c.primerApellido || ''} ${c.segundoApellido || ''} ${c.primerNombre || ''}`.toLowerCase().includes(s)
        || (c.contrato || '').toLowerCase().includes(s) || (c.numeroId || '').includes(s))
    }
    // En "Sin aprobar" el corte ya lo hizo el servidor: no hay nada que filtrar.
    if (estado && !verSinAprobar) d = d.filter(c => estadoDe(c).key === estado)
    if (campaign === SIN_CAMPANA) d = d.filter(c => !campanaDe(c))
    else if (campaign) d = d.filter(c => campanaDe(c) === campaign)
    if (fechaInicio) d = d.filter(c => new Date(c._createdDate) >= fechaInicio)
    if (fechaFin) { const f = new Date(fechaFin); f.setHours(23, 59, 59, 999); d = d.filter(c => new Date(c._createdDate) <= f) }
    return d
  }

  useEffect(() => {
    const d = filtered()
    setPage(1)
    setRows(d.slice(0, RECORDS_PER_PAGE))
  }, [all, recientes, search, estado, campaign, fechaInicio, fechaFin, tab])

  const sinCampanaTotal = esGlobal ? all.filter(c => !campanaDe(c)).length : 0

  const estadoFila = (c: Contrato) => (verSinAprobar ? estadoSinAprobar(c) : estadoDe(c))
  /** Campaña que se muestra y se exporta. */
  const campanaTexto = (c: Contrato) =>
    !c.campaign && c.campaignAnterior ? `${c.campaignAnterior} (anterior)` : (c.campaign || '')

  const data = filtered()
  const totalPages = Math.ceil(data.length / RECORDS_PER_PAGE)
  const changePage = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    setRows(data.slice((p - 1) * RECORDS_PER_PAGE, p * RECORDS_PER_PAGE))
  }

  return (
    <DashboardLayout>
      <PermissionGuard permission={AprobacionPermission.APROBADOS_VER} showDefaultMessage>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">✅ Aprobados</h1>
              <p className="mt-2 text-sm text-gray-700">
                {verSinAprobar
                  ? 'Contratos firmados que aún nadie ha aprobado, en cualquier estado'
                  : 'Contratos aprobados, inactivos y finalizados'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {esGlobal
                  ? 'Todas las campañas.'
                  : recientes.length
                  ? <>Campañas actuales: {recientes.map((c, i) => (
                      <span key={c}>
                        {i > 0 && ' y '}
                        <strong className="text-gray-700">{c}</strong>
                        {estadoCampana(c) && ` (${ESTADO_CAMPANA[estadoCampana(c)!]})`}
                      </span>
                    ))}.</>
                  : 'Campañas actuales.'}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => exportToExcel(data, [
                  { header: 'Nombre', accessor: (c) => `${c.primerNombre} ${c.primerApellido}`.trim() },
                  { header: 'Documento', accessor: (c) => c.numeroId },
                  { header: 'Contrato', accessor: (c) => c.contrato },
                  { header: 'Campaña', accessor: (c) => campanaTexto(c) },
                  { header: 'Plataforma', accessor: (c) => c.plataforma },
                  { header: 'Celular', accessor: (c) => c.celular },
                  { header: 'Email', accessor: (c) => c.email },
                  { header: 'Estado', accessor: (c) => estadoFila(c).text },
                  { header: 'Fecha', accessor: (c) => new Date(c._createdDate).toLocaleDateString() },
                ], `${verSinAprobar ? 'sin-aprobar' : 'aprobados'}-${esGlobal ? 'global' : 'recientes'}-${new Date().toISOString().split('T')[0]}`)}
                disabled={data.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Exportar Excel
              </button>
              {/* Lambda, no `onClick={load}`: si no, el MouseEvent entra como argumento. */}
              <button onClick={() => load()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2">
                <Filter className="w-4 h-4" /> Actualizar
              </button>
            </div>
          </div>

          <div className="flex gap-1 border-b border-gray-200" role="tablist">
            {([
              { id: 'recientes', label: 'Recientes' },
              { id: 'global', label: 'Global' },
            ] as const).map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                onClick={() => cambiarTab(t.id)}
                className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-purple-700 text-purple-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Filtros */}
          <div className="card p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Buscar por apellido, nombre o contrato</label>
                <input type="text" placeholder="Apellido, nombre o contrato..." value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
                <select value={campaign} onChange={(e) => setCampaign(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">Todas</option>
                  {campaignOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  {esGlobal && <option value={SIN_CAMPANA}>(Sin campaña){sinCampanaTotal ? ` · ${sinCampanaTotal}` : ''}</option>}
                </select>
              </div>
              <div className="lg:col-span-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Rango de fechas</label>
                <div className="flex gap-2">
                  <input type="date" value={fechaInicio ? fechaInicio.toISOString().split('T')[0] : ''}
                    onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setFechaInicio(new Date(+y, +m - 1, +d)) } else setFechaInicio(null) }}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  <input type="date" value={fechaFin ? fechaFin.toISOString().split('T')[0] : ''}
                    onChange={(e) => { if (e.target.value) { const [y, m, d] = e.target.value.split('-'); setFechaFin(new Date(+y, +m - 1, +d)) } else setFechaFin(null) }}
                    className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Resultados + paginación */}
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Registros ({data.length})</h2>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button onClick={() => changePage(page - 1)} disabled={page === 1}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-3 py-1 text-sm">{page} de {totalPages}</span>
                <button onClick={() => changePage(page + 1)} disabled={page === totalPages}
                  className="p-2 border rounded-lg disabled:opacity-50 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="card p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando contratos...</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="card p-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Sin registros</h3>
              <p className="text-gray-500">
                {verSinAprobar
                  ? 'No hay contratos firmados sin aprobar con esos filtros.'
                  : 'No hay contratos aprobados/inactivos/finalizados con esos filtros.'}
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Titular', 'Contrato', 'Campaña', 'Contacto', 'Estado', 'Fecha'].map(h => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {rows.map(c => {
                      const est = estadoFila(c)
                      const anterior = !c.campaign && !!c.campaignAnterior
                      return (
                        <tr key={c._id} className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => window.open(`/person/${c._id}`, '_blank')}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{c.primerNombre} {c.primerApellido}</div>
                                <div className="text-sm text-gray-500">{c.numeroId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{c.contrato}</div>
                            <div className="text-sm text-gray-500">{c.plataforma}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {anterior ? (
                              <div title="Campaña de la que salió al soltar el cupo: hoy no tiene curso asignado">
                                <div className="text-sm text-gray-500">{c.campaignAnterior}</div>
                                <div className="text-xs text-gray-400">anterior</div>
                              </div>
                            ) : (
                              <div className="text-sm text-gray-900">{c.campaign || '—'}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{c.celular}</div>
                            <div className="text-sm text-gray-500">{c.email}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${est.color}`}>{est.text}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(c._createdDate).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    })}
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
