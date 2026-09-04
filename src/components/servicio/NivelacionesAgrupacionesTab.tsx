'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { UserGroupIcon } from '@heroicons/react/24/outline'
import { ServicioPermission } from '@/types/permissions'
import { usePermissions } from '@/hooks/usePermissions'
import ConfirmacionCell from '@/components/servicio/ConfirmacionCell'

interface Row {
  academicaId: string
  curso: string | null
  nombre: string
  numeroId: string | null
  salon: string | null
  campaign: string | null
  horarioCurso: string | null
  modulo: string | null
  leccion: string | null
  tema: string | null
  guiaId: string | null
  guia: string | null
  fechaSolicitud: string | null
  hora: string | null
  motivo: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  guiaZoom: string | null
  conteo: number
  fecha: string | null
}
interface Guia { id: string; nombre: string; zoom?: string | null }

/** Clave de agrupación: la nivelación se dicta por (curso, lección). */
const claveGrupo = (r: Row) => `${r.curso || '—'}||${r.leccion || ''}`

interface Grupo {
  key: string
  curso: string
  leccion: string | null
  modulo: string | null
  tema: string | null
  rows: Row[]
}

export default function NivelacionesAgrupacionesTab({ onCount, refreshKey = 0, onMoved }: {
  onCount?: (n: number) => void
  /** Cambia cuando otra pestaña mueve una nivelación: hay que recargar. */
  refreshKey?: number
  /** Crear el grupo manda a los alumnos a Pendientes. */
  onMoved?: () => void
}) {
  const { hasPermission } = usePermissions()
  const canGestion = hasPermission(ServicioPermission.NIVELACIONES_GESTION as any)

  const [curso, setCurso] = useState('')
  const [leccion, setLeccion] = useState('')
  const [guia, setGuia] = useState('')
  const [usuario, setUsuario] = useState('')

  const [rows, setRows] = useState<Row[]>([])
  const [cursos, setCursos] = useState<string[]>([])
  const [lecciones, setLecciones] = useState<string[]>([])
  const [guias, setGuias] = useState<Guia[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [modalGrupo, setModalGrupo] = useState<Grupo | null>(null)

  const fetchData = useCallback(async (f?: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      Object.entries(f || {}).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/reports/servicio/nivelaciones/agrupaciones?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setRows(r.rows || [])
      setCursos(r.cursos || []); setLecciones(r.lecciones || []); setGuias(r.guias || [])
      setSel(new Set())
      onCount?.(r.rows?.length || 0)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [onCount])

  useEffect(() => { fetchData() }, [fetchData])

  // Las cuatro pestañas viven montadas para no perder filtros, así que una acción
  // en otra (aprobar, agrupar, cerrar) no la vería nadie hasta recargar la página.
  // Se recarga CON los filtros vigentes, no en blanco.
  useEffect(() => {
    if (!refreshKey) return
    fetchData({ curso, leccion, guia })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Los grupos se arman en el cliente sobre las filas ya filtradas: así el
  // encabezado de cada grupo cuenta exactamente lo que se está viendo.
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>()
    for (const r of rows) {
      const k = claveGrupo(r)
      let g = map.get(k)
      if (!g) {
        g = { key: k, curso: r.curso || '—', leccion: r.leccion, modulo: r.modulo, tema: r.tema, rows: [] }
        map.set(k, g)
      }
      // El módulo/tema del grupo sale de la primera fila que lo traiga: hay
      // solicitudes viejas marcadas sin lección que no lo tienen.
      if (!g.modulo && r.modulo) g.modulo = r.modulo
      if (!g.tema && r.tema) g.tema = r.tema
      g.rows.push(r)
    }
    return Array.from(map.values())
  }, [rows])

  const toggle = (id: string) => setSel(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const toggleGrupo = (g: Grupo) => setSel(prev => {
    const n = new Set(prev)
    const todos = g.rows.every(r => n.has(r.academicaId))
    g.rows.forEach(r => { if (todos) n.delete(r.academicaId); else n.add(r.academicaId) })
    return n
  })

  const abrirGestion = (g: Grupo) => {
    const seleccionados = g.rows.filter(r => sel.has(r.academicaId))
    if (!seleccionados.length) { toast.error('Marca al menos un estudiante del grupo'); return }
    setModalGrupo({ ...g, rows: seleccionados })
  }

  const aplicar = () => fetchData({ curso, leccion, guia, usuario })
  const borrar = () => { setCurso(''); setLeccion(''); setGuia(''); setUsuario(''); fetchData() }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="ag-usuario" className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
            <input id="ag-usuario" type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }}
              placeholder="Nombre o documento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label htmlFor="ag-curso" className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id="ag-curso" value={curso} onChange={e => setCurso(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ag-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
            <select id="ag-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todas</option>{lecciones.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ag-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía</label>
            <select id="ag-guia" value={guia} onChange={e => setGuia(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Todos</option>{guias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <span className="ml-auto text-sm text-gray-500">
            {rows.length} aprobada(s) sin agendar · <span className="font-semibold text-gray-700">{sel.size}</span> seleccionada(s)
          </span>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <p className="text-green-800 font-medium">No hay nivelaciones aprobadas pendientes de agendar</p>
          <p className="text-green-700 text-sm mt-1">Aparecen aquí al aprobarlas en la pestaña Solicitudes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map(g => {
            const marcados = g.rows.filter(r => sel.has(r.academicaId)).length
            const todos = marcados === g.rows.length
            return (
              <div key={g.key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <input
                    type="checkbox"
                    checked={todos}
                    onChange={() => toggleGrupo(g)}
                    aria-label={`Seleccionar todo el grupo ${g.curso} ${g.leccion || ''}`}
                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                  />
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-800">{g.curso}</span>
                    <span className="mx-2 text-gray-300">·</span>
                    <span className="font-medium text-gray-700">{g.leccion || 'Sin lección asignada'}</span>
                    {g.modulo && <span className="ml-2 text-xs text-gray-400">{g.modulo}</span>}
                    {g.tema && <span className="block text-xs text-gray-400 truncate max-w-[420px]" title={g.tema}>{g.tema}</span>}
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                    {g.rows.length} alumno(s)
                  </span>
                  <button
                    type="button"
                    onClick={() => abrirGestion(g)}
                    disabled={!canGestion || marcados === 0}
                    title={canGestion ? 'Crear la nivelación y agendar a los seleccionados' : 'Sin permiso de gestión'}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                  >
                    <UserGroupIcon className="h-5 w-5" />
                    Gestión de grupo{marcados ? ` (${marcados})` : ''}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-gray-100">
                      <tr>
                        {['', 'Fecha solicitud', 'Nombre', 'ID', 'Salón', 'Hora', 'Guía', 'Conteo', 'Confirmación'].map((h, idx) => (
                          <th key={idx} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(r => (
                        <tr key={r.academicaId} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={sel.has(r.academicaId)}
                              onChange={() => toggle(r.academicaId)}
                              aria-label={`Seleccionar ${r.nombre}`}
                              className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {r.fecha ? new Date(r.fecha).toLocaleDateString('es-CL') : '—'}
                          </td>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            <button type="button"
                              onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                              className="text-primary-600 hover:text-primary-800 hover:underline"
                              title="Ver perfil del beneficiario">
                              {r.nombre || '—'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.numeroId || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap" title={r.motivo || ''}>{r.hora || '—'}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.guia || '—'}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{r.conteo}</span>
                          </td>
                          <td className="px-3 py-2">
                            <ConfirmacionCell
                              academicaId={r.academicaId}
                              fechaSolicitud={r.fechaSolicitud ?? null}
                              confirmadoEn={r.confirmadoEn ?? null}
                              confirmadoPor={r.confirmadoPor ?? null}
                              puedeGestionar={canGestion}
                              onConfirmed={() => fetchData({ curso, leccion, guia })}
                            />
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

      {modalGrupo && (
        <GestionGrupoModal
          grupo={modalGrupo}
          guias={guias}
          onClose={() => setModalGrupo(null)}
          onDone={() => { setModalGrupo(null); fetchData({ curso, leccion, guia }); onMoved?.() }}
        />
      )}
    </div>
  )
}

/** Fecha de hoy en formato YYYY-MM-DD según el reloj de quien la usa. */
function hoyLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function GestionGrupoModal({ grupo, guias, onClose, onDone }: {
  grupo: Grupo
  guias: Guia[]
  onClose: () => void
  onDone: () => void
}) {
  // El guía, el zoom y el alcance se proponen desde el primer alumno del grupo
  // (todos comparten curso y lección), pero quedan editables: la nivelación la
  // puede dictar otro guía en otro horario.
  const primero = grupo.rows[0]
  const [advisor, setAdvisor] = useState(primero?.guiaId || '')

  // TODOS los guías activos, no sólo los de los cursos de estos alumnos.
  // La lista que llega por props alimenta el FILTRO de la tabla (ahí ofrecer un
  // guía sin filas sólo confunde), pero aquí se elige quién DICTA la nivelación
  // y puede ser cualquiera: con la lista filtrada salían 3 de 26.
  const [todosGuias, setTodosGuias] = useState<Guia[]>(guias)
  useEffect(() => {
    let vivo = true
    fetch('/api/postgres/guias', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!vivo) return
        const lista = (j?.guias || []).map((g: any) => ({
          id: g._id,
          nombre: g.nombreCompleto || [g.primerNombre, g.primerApellido].filter(Boolean).join(' '),
          zoom: g.zoom || null,
        })).filter((g: any) => g.id && g.nombre)
        if (lista.length) setTodosGuias(lista)
      })
      .catch(() => { /* se conserva la lista de props */ })
    return () => { vivo = false }
  }, [])
  const [fecha, setFecha] = useState(hoyLocal())
  const [hora, setHora] = useState('19:00')
  const [linkZoom, setLinkZoom] = useState(primero?.guiaZoom || '')
  const [limite, setLimite] = useState(String(Math.max(grupo.rows.length, 10)))
  // La nivelación dura 30 min por defecto; la casilla la amplía a una hora.
  const [unaHora, setUnaHora] = useState(false)
  const [modulo, setModulo] = useState(grupo.modulo || '')
  const [leccion, setLeccion] = useState(grupo.leccion || '')
  const [saving, setSaving] = useState(false)

  const guardar = async () => {
    if (!advisor) { toast.error('Elige el guía'); return }
    if (!fecha || !hora) { toast.error('Completa fecha y hora'); return }
    setSaving(true)
    try {
      // El instante se arma aquí (reloj del navegador), igual que el modal de
      // eventos del calendario.
      const dia = new Date(`${fecha}T${hora}:00`).toISOString()
      const r = await fetch('/api/postgres/reports/servicio/nivelaciones/gestion-grupo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicaIds: grupo.rows.map(x => x.academicaId),
          advisor, dia, fecha, hora, linkZoom,
          limiteUsuarios: Number(limite) || 30,
          unaHora,
          curso: grupo.curso, modulo, leccion,
          campaign: primero?.campaign || null,
          salon: primero?.salon || null,
        }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      if (r.enrollError) toast.error(r.message)
      else toast.success(r.message || 'Nivelación creada')
      onDone()
    } catch (e: any) {
      toast.error(e?.message || 'Error al crear la nivelación')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Gestión de grupo — Nivelación</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {grupo.curso} · {leccion || 'Sin lección'} · {grupo.rows.length} estudiante(s)
            </p>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="gg-guia" className="block text-xs font-medium text-gray-500 mb-1">Guía *</label>
              {/* El Zoom sigue al guía: al elegir otro, dejar la sala del guía
                  original mandaría a los alumnos a una reunión que no es la suya.
                  Sólo se pisa si el guía nuevo tiene sala; si no, se conserva lo
                  escrito para no borrar un link puesto a mano. */}
              <select id="gg-guia" value={advisor}
                onChange={e => {
                  const id = e.target.value
                  setAdvisor(id)
                  const z = todosGuias.find(g => g.id === id)?.zoom
                  if (z) setLinkZoom(z)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">— Elegir guía —</option>
                {todosGuias.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="gg-limite" className="block text-xs font-medium text-gray-500 mb-1">Límite de usuarios</label>
              <input id="gg-limite" type="number" min={1} value={limite} onChange={e => setLimite(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="gg-fecha" className="block text-xs font-medium text-gray-500 mb-1">Fecha *</label>
              <input id="gg-fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="gg-hora" className="block text-xs font-medium text-gray-500 mb-1">Hora *</label>
              <input id="gg-hora" type="time" step={1800} value={hora} onChange={e => setHora(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="gg-modulo" className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
              <input id="gg-modulo" value={modulo} onChange={e => setModulo(e.target.value)} placeholder="Modulo 01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label htmlFor="gg-leccion" className="block text-xs font-medium text-gray-500 mb-1">Lección</label>
              <input id="gg-leccion" value={leccion} onChange={e => setLeccion(e.target.value)} placeholder="Lección 02"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={unaHora} onChange={e => setUnaHora(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-primary-600 rounded focus:ring-primary-500" />
                <span className="text-sm text-gray-700">
                  Ampliar a <b>1 hora</b>
                  <span className="block text-xs text-gray-500">Sin marcar, la nivelación dura 30 minutos.</span>
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="gg-zoom" className="block text-xs font-medium text-gray-500 mb-1">Link de Zoom</label>
              <input id="gg-zoom" value={linkZoom} onChange={e => setLinkZoom(e.target.value)} placeholder="https://zoom.us/j/…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Se agendarán</p>
            <ul className="text-sm text-gray-700 space-y-1 max-h-40 overflow-y-auto">
              {grupo.rows.map(r => (
                <li key={r.academicaId} className="flex justify-between gap-3">
                  <span>{r.nombre}</span>
                  <span className="text-gray-400 whitespace-nowrap">{r.salon || '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">
            {saving ? 'Creando…' : 'Crear nivelación y agendar'}
          </button>
        </div>
      </div>
    </div>
  )
}
