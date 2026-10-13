'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PermissionGuard } from '@/components/permissions'
import AgendarWelcomeModal from '@/components/servicio/AgendarWelcomeModal'
import { ServicioPermission } from '@/types/permissions'
import { formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/export-excel'
import { ESTADO_CURSO_META, type CampanaEstado } from '@/lib/cursos-campaign'
import { coincidePersona } from '@/lib/busqueda-persona'

/** Valor del desplegable de campaña: el conjunto "actuales" o una campaña concreta. */
const CAMPANA_ACTUALES = '__actuales__'
const CAMPANA_TODAS = '__todas__'

interface Props {
  /** Estado de cada campaña, para etiquetar las opciones del desplegable. */
  estadosCampana: CampanaEstado[]
  /** Las campañas por defecto: la que está en matrícula y la activa más reciente. */
  actuales: string[]
}

/** Un alumno que no asistió a su sesión de bienvenida. */
interface Inasistente {
  _id: string
  idEstudiante: string
  primerNombre: string
  primerApellido: string
  celular: string
  numeroId: string
  contrato?: string
  campaign: string
  tipoCurso: string
  plataforma: string
  fechaEvento: string
  eventoId: string
  modulo: string
  advisorNombre: string
  /** Fecha de su próxima sesión WELCOME viva, si ya lo reagendaron. Se DERIVA. */
  reagendadoA: string | null
}

/** La sesión perdida, con los alumnos que faltaron a ella. */
interface Grupo {
  eventoId: string
  fechaEvento: string
  advisorNombre: string
  modulo: string
  filas: Inasistente[]
}

const nombreDe = (r: Inasistente) => `${r.primerNombre} ${r.primerApellido}`.trim() || '(sin nombre)'

export default function WelcomeReagendamientosTab({ estadosCampana, actuales }: Props) {
  const [rows, setRows] = useState<Inasistente[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [buscar, setBuscar] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(true)
  // Mismo default que la pestaña de eventos: las campañas actuales.
  const [campanaFiltro, setCampanaFiltro] = useState<string>(CAMPANA_ACTUALES)

  // Alumno al que se está reagendando (abre el modal compartido).
  const [target, setTarget] = useState<Inasistente | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ mode: 'reagendamientos' })
      if (startDate) params.set('startDate', new Date(startDate + 'T00:00:00').toISOString())
      if (endDate) params.set('endDate', new Date(endDate + 'T23:59:59').toISOString())
      const res = await fetch(`/api/postgres/events/welcome?${params.toString()}`)
      if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al cargar')
      setRows(data.events || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => { cargar() }, [cargar])

  /** Campañas presentes en los datos, la más reciente primero. */
  const campanasEnDatos = useMemo(() => {
    const set = new Set(rows.map((r) => (r.campaign || '').trim()).filter(Boolean))
    const orden = new Map(estadosCampana.map((c) => [c.campaign, c.inicio || '']))
    return Array.from(set).sort((a, b) => String(orden.get(b) || '').localeCompare(String(orden.get(a) || '')))
  }, [rows, estadosCampana])

  /** La campaña sale del ALUMNO: el evento WELCOME es comodín. */
  const enCampana = useCallback((r: Inasistente) => {
    if (campanaFiltro === CAMPANA_TODAS) return true
    const c = (r.campaign || '').trim()
    // Mientras el catálogo no haya cargado no se esconde nada.
    if (campanaFiltro === CAMPANA_ACTUALES) return actuales.length === 0 || actuales.includes(c)
    return c === campanaFiltro
  }, [campanaFiltro, actuales])

  const filtradas = useMemo(() => rows.filter((r) => {
    if (soloPendientes && r.reagendadoA) return false
    if (!enCampana(r)) return false
    return coincidePersona({ nombre: nombreDe(r), numeroId: r.numeroId, contrato: r.contrato }, buscar)
  }), [rows, buscar, soloPendientes, enCampana])

  /** Agrupado POR SESIÓN: quien gestiona trabaja una bienvenida a la vez. */
  const grupos = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>()
    for (const r of filtradas) {
      const key = r.eventoId || r.fechaEvento
      const g = mapa.get(key)
      if (g) g.filas.push(r)
      else mapa.set(key, {
        eventoId: key,
        fechaEvento: r.fechaEvento,
        advisorNombre: r.advisorNombre,
        modulo: r.modulo,
        filas: [r],
      })
    }
    return Array.from(mapa.values())
  }, [filtradas])

  // El contador sigue a la campaña elegida: es el total de lo que se está mirando.
  const enAlcance = useMemo(() => rows.filter(enCampana), [rows, enCampana])
  const pendientes = useMemo(() => enAlcance.filter((r) => !r.reagendadoA).length, [enAlcance])

  const abrirModal = (r: Inasistente) => setTarget(r)

  return (
    <div className="card">
      <div className="card-content">
        {/* Filtros */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
            <div>
              <label htmlFor="reaCampana" className="block text-sm font-medium text-gray-700 mb-1">
                Campaña
              </label>
              <select
                id="reaCampana"
                value={campanaFiltro}
                onChange={(e) => setCampanaFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value={CAMPANA_ACTUALES}>
                  Actuales{actuales.length ? ` (${actuales.join(' + ')})` : ''}
                </option>
                <option value={CAMPANA_TODAS}>Todas</option>
                {campanasEnDatos.map((c) => {
                  const est = estadosCampana.find((e) => e.campaign === c)
                  return (
                    <option key={c} value={c}>
                      {c}{est ? ` — ${ESTADO_CURSO_META[est.estado].label}` : ''}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label htmlFor="reaBuscar" className="block text-sm font-medium text-gray-700 mb-1">
                Nombre, ID o contrato
              </label>
              <input
                type="text"
                id="reaBuscar"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Nombre, documento o contrato..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="reaDesde" className="block text-sm font-medium text-gray-700 mb-1">
                Fecha desde
              </label>
              <input
                type="date"
                id="reaDesde"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="reaHasta" className="block text-sm font-medium text-gray-700 mb-1">
                Fecha hasta
              </label>
              <input
                type="date"
                id="reaHasta"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div className="flex items-center h-[38px]">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soloPendientes}
                  onChange={(e) => setSoloPendientes(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Solo sin reagendar
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setStartDate(''); setEndDate(''); setBuscar(''); setSoloPendientes(true); setCampanaFiltro(CAMPANA_ACTUALES) }}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Limpiar
              </button>
              <button
                onClick={() => exportToExcel(filtradas, [
                  { header: 'Nombre', accessor: (r) => nombreDe(r) },
                  { header: 'ID', accessor: (r) => r.numeroId || '' },
                  { header: 'Contrato', accessor: (r) => r.contrato || '' },
                  { header: 'Celular', accessor: (r) => r.celular || '' },
                  { header: 'Campaña', accessor: (r) => r.campaign || '' },
                  { header: 'Curso', accessor: (r) => r.tipoCurso || '' },
                  { header: 'Sesión perdida', accessor: (r) => formatDateTime(r.fechaEvento) },
                  { header: 'Guía', accessor: (r) => r.advisorNombre || '' },
                  { header: 'Reagendado a', accessor: (r) => (r.reagendadoA ? formatDateTime(r.reagendadoA) : 'Pendiente') },
                ], `welcome-reagendamientos-${new Date().toISOString().split('T')[0]}`)}
                disabled={filtradas.length === 0}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Excel
              </button>
            </div>
          </div>

          <div className="mt-3 text-sm text-gray-600">
            {loading
              ? 'Cargando…'
              : `Mostrando ${filtradas.length} de ${enAlcance.length} inasistente(s) · ${pendientes} sin reagendar · ${grupos.length} sesión(es)`}
          </div>
        </div>

        {error ? (
          <div className="alert alert-error">
            <div className="ml-3 text-sm text-red-700">{error}</div>
          </div>
        ) : grupos.length === 0 && !loading ? (
          <div className="text-center py-10 text-gray-500">
            <h3 className="text-sm font-medium text-gray-900">No hay inasistencias</h3>
            <p className="mt-1 text-sm">
              {enAlcance.length > 0
                ? 'No hay inasistentes sin reagendar con esos filtros.'
                : 'No se registran inasistencias a sesiones WELCOME con esos filtros.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => {
              const sinReagendar = g.filas.filter((f) => !f.reagendadoA).length
              return (
                <div key={g.eventoId} className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-purple-50 border-b flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold text-purple-900">{formatDateTime(g.fechaEvento)}</span>
                      <span className="text-purple-700"> · {g.advisorNombre || 'Sin guía'}</span>
                      {g.modulo ? <span className="text-purple-700"> · {g.modulo}</span> : null}
                    </div>
                    <span className="text-xs font-medium text-purple-800 bg-purple-100 px-2 py-1 rounded-full">
                      {g.filas.length} inasistente(s) · {sinReagendar} sin reagendar
                    </span>
                  </div>
                  <div className="table-container">
                    <table className="table">
                      <thead className="table-header">
                        <tr>
                          <th className="table-header-cell">Alumno</th>
                          <th className="table-header-cell">ID</th>
                          <th className="table-header-cell">Celular</th>
                          <th className="table-header-cell">Campaña</th>
                          <th className="table-header-cell">Curso</th>
                          <th className="table-header-cell">Estado</th>
                          <th className="table-header-cell text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="table-body">
                        {g.filas.map((r) => (
                          <tr key={r._id} className="hover:bg-gray-50">
                            <td className="table-cell">
                              {r.idEstudiante ? (
                                <a
                                  href={`/student/${r.idEstudiante}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-blue-600 hover:underline"
                                >
                                  {nombreDe(r)}
                                </a>
                              ) : (
                                <span className="text-sm font-medium text-gray-900">{nombreDe(r)}</span>
                              )}
                            </td>
                            <td className="table-cell text-sm text-gray-500">
                              <div>{r.numeroId || '—'}</div>
                              {r.contrato ? <div className="text-xs text-gray-400">{r.contrato}</div> : null}
                            </td>
                            <td className="table-cell text-sm text-gray-500">{r.celular || '—'}</td>
                            <td className="table-cell text-sm text-gray-500">{r.campaign || '—'}</td>
                            <td className="table-cell text-sm text-gray-500">{r.tipoCurso || '—'}</td>
                            <td className="table-cell">
                              {r.reagendadoA ? (
                                <span className="badge badge-success">✓ Reagendado al {formatDateTime(r.reagendadoA)}</span>
                              ) : (
                                <span className="badge badge-warning">Pendiente</span>
                              )}
                            </td>
                            <td className="table-cell text-right">
                              <PermissionGuard permission={ServicioPermission.WELCOME_REAGENDAR}>
                                <button
                                  onClick={() => abrirModal(r)}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
                                >
                                  {r.reagendadoA ? 'Reagendar otra vez' : 'Reagendar'}
                                </button>
                              </PermissionGuard>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal de reagendamiento */}
      {target && (
        <AgendarWelcomeModal
          studentId={target.idEstudiante}
          nombre={nombreDe(target)}
          tipoCurso={target.tipoCurso}
          titulo="Reagendar sesión de bienvenida"
          accion="Reagendar"
          aviso={<>
            La sesión a la que no asistió <strong>no se borra</strong>: queda como parte de su historia.
            Al agendarle una nueva, el alumno sale de esta bandeja.
          </>}
          onClose={() => setTarget(null)}
          onAgendado={() => { setTarget(null); cargar() }}
        />
      )}
    </div>
  )
}
