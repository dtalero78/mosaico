'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import ConfirmacionCell from '@/components/servicio/ConfirmacionCell'
import { metaResultadoNivelacion } from '@/lib/nivelacion-resultados'
import { usePermissions } from '@/hooks/usePermissions'
import { MAX_RECUPERACION } from '@/lib/nivelacion-recuperacion'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  salon: string | null
  guiaId: string | null
  guia: string | null
  fecha: string | null
  /** Cuándo la pidió el guía (las entradas viejas no la guardaron). */
  fechaSolicitud: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  /** Fecha del evento en que se dictó. */
  fechaEvento: string | null
  estado: string | null
  modulo: string | null
  leccion: string | null
  conteo: number
  comentario: string | null
  marcadoPor: string | null
  /** Fecha cruda de la entrada: es su llave al recuperarla. */
  entradaFecha: string | null
  recuperadaEn: string | null
  recuperadaPor: string | null
  /** ¿Es la última entrada del alumno? Sólo esa se puede recuperar. */
  esUltima: boolean
  /** ¿El alumno ya tiene otra nivelación en curso? */
  tieneViva: boolean
}
interface Guia { id: string; nombre: string }

const fmtDia = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('es-CL') : '—'

/** Llave de una fila para la selección. */
const llave = (r: Row) => `${r.academicaId}|${r.entradaFecha || ''}`

/**
 * ¿Se ofrece la casilla? Es la misma regla de `motivoNoRecuperable` del
 * servidor, que la vuelve a validar con las filas bloqueadas.
 */
const esRecuperable = (r: Row) =>
  r.estado === 'CANCELADA_SIN_CONFIRMAR' && !r.recuperadaEn && r.esUltima && !r.tieneViva && !!r.entradaFecha

export default function NivelacionesHistorialTab({ refreshKey = 0, onMoved }: {
  /** Cambia cuando otra pestaña cierra una nivelación: hay que recargar. */
  refreshKey?: number
  /** Una nivelación volvió a Solicitudes: las demás pestañas deben recargar. */
  onMoved?: () => void
} = {}) {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.NIVELACIONES_GESTION as any)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState(false)
  const [recuperando, setRecuperando] = useState(false)
  const [guia, setGuia] = useState('')
  const [curso, setCurso] = useState('')
  const [usuario, setUsuario] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)
  /** Rol GUIA: el servidor ya acota a lo suyo, así que el filtro de Guía sobra. */
  const [soloPropios, setSoloPropios] = useState(false)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones/historial?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setSeleccion(new Set())
      setCursos(r.cursos || []); setGuias(r.guias || [])
      setSoloPropios(!!r.soloPropios)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!refreshKey) return
    fetchData({ guia, curso, usuario, startDate, endDate })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // El servidor ya devuelve todo ordenado de la más reciente a la más antigua;
  // aquí sólo se parte en bloques por curso conservando ese orden, para que el
  // primer curso que aparece sea el de la nivelación más reciente.
  const grupos = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) {
      const k = r.curso || '— Sin curso —'
      const arr = map.get(k)
      if (arr) arr.push(r); else map.set(k, [r])
    }
    return Array.from(map.entries())
  }, [rows])

  const recuperables = useMemo(() => rows.filter(esRecuperable), [rows])
  const seleccionadas = useMemo(() => recuperables.filter(r => seleccion.has(llave(r))), [recuperables, seleccion])
  const todasMarcadas = recuperables.length > 0 && seleccionadas.length === recuperables.length

  const alternar = (r: Row) => setSeleccion(prev => {
    const s = new Set(prev)
    const k = llave(r)
    if (s.has(k)) s.delete(k); else s.add(k)
    return s
  })
  const alternarTodas = () =>
    setSeleccion(todasMarcadas ? new Set() : new Set(recuperables.map(llave)))

  const recuperar = async () => {
    setRecuperando(true)
    try {
      const r = await fetch('/api/postgres/reports/servicio/nivelaciones/recuperar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: seleccionadas.map(x => ({ academicaId: x.academicaId, fecha: x.entradaFecha })),
        }),
      }).then(x => x.json())
      if (!r.success) throw new Error(r.error || 'No se pudo recuperar')
      toast.success(`${r.recuperadas} nivelación(es) recuperada(s): volvieron a Solicitudes`)
      setConfirmar(false)
      await fetchData({ guia, curso, usuario, startDate, endDate })
      onMoved?.()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo recuperar', { duration: 8000 })
    } finally {
      setRecuperando(false)
    }
  }

  const aplicar = () => fetchData({ guia, curso, usuario, startDate, endDate })
  const borrar = () => { setGuia(''); setCurso(''); setUsuario(''); setStartDate(''); setEndDate(''); fetchData() }
  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Fecha solicitud', accessor: r => (r.fechaSolicitud ? new Date(r.fechaSolicitud).toLocaleDateString('es-CL') : '') },
      { header: 'Curso', accessor: r => r.curso || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Módulo', accessor: r => r.modulo || '' },
      { header: 'Lección', accessor: r => r.leccion || '' },
      { header: 'Conteo', accessor: r => (r.conteo ?? '') },
      { header: 'Confirmación', accessor: r => (r.confirmadoEn ? (r.confirmadoPor === 'SERVICIO' ? 'Confirmada (Servicio)' : 'Confirmada') : 'Sin confirmar') },
      { header: 'Estado', accessor: r => (r.estado ? metaResultadoNivelacion(r.estado).label : '') },
      { header: 'Fecha asignada', accessor: r => (r.fechaEvento ? new Date(r.fechaEvento).toLocaleDateString('es-CL') : '') },
      { header: 'Comentario', accessor: r => r.comentario || '' },
      { header: 'Registrado por', accessor: r => r.marcadoPor || '' },
      { header: 'Fecha de cierre', accessor: r => (r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '') },
      { header: 'Recuperada', accessor: r => (r.recuperadaEn ? `${new Date(r.recuperadaEn).toLocaleDateString('es-CL')}${r.recuperadaPor ? ` · ${r.recuperadaPor}` : ''}` : '') },
    ], 'nivelaciones-historial')
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label htmlFor="hi-usuario" className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
            <input id="hi-usuario" type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }}
              placeholder="Nombre o documento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          {!soloPropios && (
            <div>
              <label htmlFor="hi-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
              <select id="hi-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="hi-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="hi-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="hi-desde" className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
            <input id="hi-desde" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="hi-hasta" className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
            <input id="hi-hasta" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.NIVELACIONES_EXPORTAR}>
            <button type="button" onClick={exportar} disabled={!rows.length}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
          <span className="ml-auto text-sm text-gray-500">
            Total: <span className="font-semibold text-gray-700">{rows.length}</span>
          </span>
        </div>
      </div>

      {canGestion && !loading && recuperables.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 mb-4">
          <label className="inline-flex items-center gap-2 text-sm text-sky-900 cursor-pointer">
            <input type="checkbox" checked={todasMarcadas} onChange={alternarTodas}
              className="rounded border-sky-400 text-sky-600" />
            Marcar todas las recuperables ({recuperables.length})
          </label>
          <span className="text-xs text-sky-700">
            Sólo las «Cancelada (sin confirmar)» vuelven a Solicitudes.
          </span>
          <button type="button"
            onClick={() => setConfirmar(true)}
            disabled={!seleccionadas.length || seleccionadas.length > MAX_RECUPERACION}
            className="ml-auto px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50">
            ↺ Recuperar a Solicitudes ({seleccionadas.length})
          </button>
          {seleccionadas.length > MAX_RECUPERACION && (
            <span className="w-full text-xs text-red-600">Máximo {MAX_RECUPERACION} por operación.</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Sin nivelaciones registradas</div>
      ) : (
        <div className="space-y-4">
          {grupos.map(([cursoNombre, filas]) => (
            <div key={cursoNombre} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                <span className="font-semibold text-gray-800">{cursoNombre}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">
                  {filas.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white border-b border-gray-100">
                    <tr>
                      {canGestion && <th className="px-3 py-2 w-8" aria-label="Recuperar" />}
                      {['Fecha solicitud', 'Nombre', 'Salón', 'Guía', 'Módulo · Lección', 'Conteo', 'Confirmación', 'Estado', 'Comentario', 'Fecha asignada'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((r, idx) => {
                      const meta = metaResultadoNivelacion(r.estado)
                      // Quién la cerró y cuándo: en una removida es lo que se
                      // pidió dejar a la vista, y sirve igual para los demás cierres.
                      const cierre = [r.marcadoPor, r.fecha ? fmtDia(r.fecha) : null].filter(Boolean).join(' · ')
                      return (
                        <tr key={`${r.academicaId}-${r.fecha}-${idx}`}
                          className={`border-b border-gray-100 hover:bg-gray-50 ${seleccion.has(llave(r)) ? 'bg-sky-50' : ''}`}>
                          {canGestion && (
                            <td className="px-3 py-2">
                              {esRecuperable(r) && (
                                <input type="checkbox" checked={seleccion.has(llave(r))} onChange={() => alternar(r)}
                                  title="Marcar para recuperar a Solicitudes"
                                  aria-label={`Recuperar la nivelación de ${r.nombre}`}
                                  className="rounded border-gray-300 text-sky-600" />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {fmtDia(r.fechaSolicitud)}
                          </td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            <button type="button"
                              onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                              className="text-primary-600 hover:text-primary-800 hover:underline"
                              title="Ver perfil del beneficiario">
                              {r.nombre || '—'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.leccion || r.modulo
                              ? <span>{r.modulo ? <span className="text-gray-400">{r.modulo} · </span> : null}{r.leccion || '—'}</span>
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                          </td>
                          <td className="px-3 py-2">
                            <ConfirmacionCell
                              fechaSolicitud={r.fechaSolicitud ?? null}
                              confirmadoEn={r.confirmadoEn ?? null}
                              confirmadoPor={r.confirmadoPor ?? null}
                              soloLectura
                            />
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${meta.cls}`}
                              title={cierre ? `Registrado por ${cierre}` : undefined}>{meta.label}</span>
                            {r.estado === 'REMOVIDA' && cierre && (
                              <span className="block text-xs text-gray-400 mt-0.5 whitespace-nowrap">{cierre}</span>
                            )}
                            {r.recuperadaEn && (
                              <span className="block text-xs text-sky-700 font-medium mt-0.5 whitespace-nowrap"
                                title={`Recuperada a Solicitudes${r.recuperadaPor ? ` por ${r.recuperadaPor}` : ''}`}>
                                ↺ Recuperada · {fmtDia(r.recuperadaEn)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={r.comentario || ''}>{r.comentario || '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDia(r.fechaEvento)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Recuperar a Solicitudes</h3>
            <p className="text-sm text-gray-600 mb-3">
              {seleccionadas.length === 1 ? 'Esta nivelación vuelve' : `Estas ${seleccionadas.length} nivelaciones vuelven`} a
              Solicitudes como pedidas y sin aprobar:
            </p>
            <ul className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3">
              {seleccionadas.map(r => (
                <li key={llave(r)} className="px-3 py-1.5 text-sm flex justify-between gap-3">
                  <span className="font-medium text-gray-800">{r.nombre}</span>
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    {[r.modulo, r.leccion].filter(Boolean).join(' · ') || '—'}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="text-xs text-gray-600 space-y-1 mb-4 list-disc pl-4">
              <li>El conteo de nivelaciones de cada usuario sube 1 (se repone el que quitó la cancelación).</li>
              <li>El plazo para confirmar empieza de nuevo desde hoy.</li>
              <li>Hay que volver a aprobarlas en Solicitudes.</li>
              <li>La entrada del Histórico se conserva marcada «Recuperada».</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} disabled={recuperando}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={recuperar} disabled={recuperando}
                className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50">
                {recuperando ? 'Recuperando…' : `Recuperar (${seleccionadas.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
