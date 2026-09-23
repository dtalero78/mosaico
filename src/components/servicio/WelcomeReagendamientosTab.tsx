'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import SobrecupoModal, { esSobrecupo, type SobrecupoDetalle } from '@/components/common/SobrecupoModal'
import { ServicioPermission, AcademicoPermission } from '@/types/permissions'
import { formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/export-excel'

/** Un alumno que no asistió a su sesión de bienvenida. */
interface Inasistente {
  _id: string
  idEstudiante: string
  primerNombre: string
  primerApellido: string
  celular: string
  numeroId: string
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

/** Una sesión WELCOME futura a la que se puede mover al alumno. */
interface EventoFuturo {
  _id: string
  fechaEvento: string
  hora: string | null
  modulo: string
  advisorNombre: string
  limiteUsuarios: number
  inscritos: number
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

export default function WelcomeReagendamientosTab() {
  const { hasPermission } = usePermissions()
  // Autorizar sobrecupo es un permiso aparte del de reagendar.
  const puedeAutorizarSobrecupo = hasPermission(AcademicoPermission.SOBRECUPO_AUTORIZAR)
  const [rows, setRows] = useState<Inasistente[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [buscar, setBuscar] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(true)

  // Modal de reagendamiento
  const [target, setTarget] = useState<Inasistente | null>(null)
  const [opciones, setOpciones] = useState<EventoFuturo[]>([])
  const [moduloDestino, setModuloDestino] = useState('')
  const [cargandoOpciones, setCargandoOpciones] = useState(false)
  const [elegido, setElegido] = useState('')
  const [guardando, setGuardando] = useState(false)
  /** Detalle de la sesión llena; abre el modal de sobrecupo cuando llega. */
  const [sobrecupo, setSobrecupo] = useState<SobrecupoDetalle | null>(null)

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

  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return rows.filter((r) => {
      if (soloPendientes && r.reagendadoA) return false
      if (!q) return true
      return (
        nombreDe(r).toLowerCase().includes(q) ||
        (r.numeroId || '').toLowerCase().includes(q)
      )
    })
  }, [rows, buscar, soloPendientes])

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

  const pendientes = useMemo(() => rows.filter((r) => !r.reagendadoA).length, [rows])

  const abrirModal = async (r: Inasistente) => {
    setTarget(r)
    setElegido('')
    setOpciones([])
    setModuloDestino('')
    setCargandoOpciones(true)
    try {
      const res = await fetch(`/api/postgres/events/welcome?mode=futuros&curso=${encodeURIComponent(r.tipoCurso || '')}`)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      setOpciones(data.events || [])
      setModuloDestino(data.modulo || '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron cargar las sesiones')
    } finally {
      setCargandoOpciones(false)
    }
  }

  const confirmar = async (autorizarSobrecupo = false) => {
    if (!target || !elegido) return
    setGuardando(true)
    try {
      const res = await fetch('/api/postgres/events/welcome/reagendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventoId: elegido, studentId: target.idEstudiante, autorizarSobrecupo }),
      })
      const data = await res.json()
      // Sesión llena: el modal dice cuánto se pasa y lo autoriza quien pueda.
      if (!res.ok && esSobrecupo(data?.detail)) { setSobrecupo(data.detail); return }
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      toast.success(data.message || 'Alumno reagendado')
      setTarget(null)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo reagendar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="card">
      <div className="card-content">
        {/* Filtros */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <label htmlFor="reaBuscar" className="block text-sm font-medium text-gray-700 mb-1">
                Nombre o ID
              </label>
              <input
                type="text"
                id="reaBuscar"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Nombre o documento..."
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
                onClick={() => { setStartDate(''); setEndDate(''); setBuscar(''); setSoloPendientes(true) }}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50"
              >
                Limpiar
              </button>
              <button
                onClick={() => exportToExcel(filtradas, [
                  { header: 'Nombre', accessor: (r) => nombreDe(r) },
                  { header: 'ID', accessor: (r) => r.numeroId || '' },
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
              : `Mostrando ${filtradas.length} de ${rows.length} inasistente(s) · ${pendientes} sin reagendar · ${grupos.length} sesión(es)`}
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
              {rows.length > 0
                ? 'Todos los inasistentes del rango ya tienen una nueva sesión de bienvenida.'
                : 'No se registran inasistencias a sesiones WELCOME en el rango seleccionado.'}
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
                            <td className="table-cell text-sm text-gray-500">{r.numeroId || '—'}</td>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Reagendar sesión de bienvenida</h3>
              <p className="mt-1 text-sm text-gray-600">
                <span className="font-medium">{nombreDe(target)}</span>
                {target.tipoCurso ? ` · ${target.tipoCurso}` : ''}
                {moduloDestino ? ` · módulo ${moduloDestino}` : ''}
              </p>
            </div>

            <div className="px-6 py-4">
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                La sesión a la que no asistió <strong>no se borra</strong>: queda como parte de su historia.
                Al agendarle una nueva, el alumno sale de esta bandeja.
              </div>

              {cargandoOpciones ? (
                <div className="py-8 text-center text-sm text-gray-500">Cargando sesiones disponibles…</div>
              ) : opciones.length === 0 ? (
                <div className="py-6 px-4 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                  No hay sesiones WELCOME futuras del módulo <strong>{moduloDestino || '—'}</strong>.
                  Hay que crear una en el Calendario de Eventos antes de poder reagendar.
                </div>
              ) : (
                <div className="space-y-2">
                  {opciones.map((ev) => {
                    const lleno = ev.limiteUsuarios > 0 && ev.inscritos >= ev.limiteUsuarios
                    return (
                      <label
                        key={ev._id}
                        className={`flex items-center gap-3 p-3 border rounded-md ${
                          lleno
                            ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                            : elegido === ev._id
                            ? 'bg-purple-50 border-purple-400 cursor-pointer'
                            : 'bg-white border-gray-300 hover:bg-gray-50 cursor-pointer'
                        }`}
                      >
                        <input
                          type="radio"
                          name="eventoDestino"
                          value={ev._id}
                          disabled={lleno}
                          checked={elegido === ev._id}
                          onChange={() => setElegido(ev._id)}
                          className="h-4 w-4 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="flex-1 text-sm">
                          <span className="font-medium text-gray-900">{formatDateTime(ev.fechaEvento)}</span>
                          <span className="text-gray-600"> · {ev.advisorNombre || 'Sin guía'}</span>
                        </span>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                          lleno ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {ev.inscritos}/{ev.limiteUsuarios || '∞'}{lleno ? ' · LLENO' : ''}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setTarget(null)}
                disabled={guardando}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => confirmar()}
                disabled={!elegido || guardando}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {guardando ? 'Reagendando…' : 'Reagendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sesión llena: se autoriza el sobrecupo o se elige otro horario */}
      {sobrecupo && (
        <SobrecupoModal
          detalle={sobrecupo}
          puedeAutorizar={puedeAutorizarSobrecupo}
          procesando={guardando}
          onCancel={() => setSobrecupo(null)}
          onConfirm={() => { setSobrecupo(null); confirmar(true) }}
        />
      )}
    </div>
  )
}
