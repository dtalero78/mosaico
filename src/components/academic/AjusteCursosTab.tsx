'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { estadoCurso, ESTADO_CURSO_META, hoyEnChile } from '@/lib/cursos-campaign'
import { addDaysISO } from '@/lib/calendario-curso'

/**
 * Campañas › Ajuste Cursos.
 *
 *  - Cierre: adelanta el final. Borra las clases posteriores a la fecha elegida y
 *    sus agendamientos; el curso pasa a Cerrado desde el día siguiente y su guía
 *    queda libre para otro curso desde ese día.
 *  - Ampliación: extiende el final y agrega las clases nuevas, con los
 *    agendamientos de los alumnos que están en el curso.
 *
 * Un curso ajustado ya no se edita desde Gestión. La vista previa se pide al
 * servidor antes de confirmar: es el mismo cálculo que se aplicará.
 */

interface Fila {
  _id: string
  campaign: string
  tipoCurso: string
  salon: string | null
  guiaNombre: string | null
  horarioCurso: string
  inicioCurso: string | null
  finalCurso: string | null
  cierreCurso: string | null
  inicioCampanaCursos: string | null
  numeroUsuarios: number
  usuInscritos: number
  clasesTotal: number
  clasesDictadas: number
  ultimaClase: string | null
  grupoHorarioId: string | null
  ajustes: number
  ajustesHistory: any[]
  esImpulsa: boolean
}

type Accion = 'cierre' | 'ampliacion'

const fmt = (d?: string | null) => (d ? String(d).slice(0, 10) : '—')

async function postAjuste(id: string, body: any) {
  const res = await fetch(`/api/postgres/campaigns/${id}/ajuste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.error) throw new Error(j?.error || j?.message || `Error ${res.status}`)
  return j
}

export default function AjusteCursosTab({
  campanias,
  campaignInicial,
  onAjustado,
}: {
  campanias: string[]
  campaignInicial: string
  /** Para refrescar la pestaña Gestión (el lápiz de un curso ajustado se deshabilita). */
  onAjustado?: () => void
}) {
  const [campaign, setCampaign] = useState(campaignInicial || '')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [rows, setRows] = useState<Fila[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Modal de ajuste
  const [modal, setModal] = useState<{ fila: Fila; accion: Accion } | null>(null)
  const [fecha, setFecha] = useState('')
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<any | null>(null)
  const [confirmo, setConfirmo] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [historial, setHistorial] = useState<Fila | null>(null)

  const hoy = hoyEnChile()

  useEffect(() => {
    if (!campaign && campanias.length) setCampaign(campaignInicial || campanias[0])
  }, [campanias, campaign, campaignInicial])

  const cargar = useCallback(async () => {
    if (!campaign) { setRows([]); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/postgres/campaigns/ajuste?campaign=${encodeURIComponent(campaign)}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || `Error ${res.status}`)
      setRows(Array.isArray(j.rows) ? j.rows : [])
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los cursos')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [campaign])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setCurso(''); setSalon('') }, [campaign])

  const cursos = useMemo(() => Array.from(new Set(rows.map(r => r.tipoCurso))), [rows])
  const salones = useMemo(
    () => Array.from(new Set(rows.filter(r => !curso || r.tipoCurso === curso).map(r => r.salon || '—'))).sort(),
    [rows, curso]
  )
  const visibles = useMemo(
    () => rows.filter(r => (!curso || r.tipoCurso === curso) && (!salon || (r.salon || '—') === salon)),
    [rows, curso, salon]
  )

  const abrir = (fila: Fila, accion: Accion) => {
    setModal({ fila, accion })
    setPreview(null); setConfirmo(false); setMotivo(''); setModalError(null)
    // Cierre: propone hoy. Ampliación: propone un mes después del final actual.
    if (accion === 'cierre') setFecha(hoy)
    else setFecha(fila.finalCurso ? addDaysISO(fila.finalCurso, 30) : '')
  }
  const cerrarModal = () => { if (!trabajando) setModal(null) }

  const verEfecto = async () => {
    if (!modal) return
    setTrabajando(true); setModalError(null); setPreview(null); setConfirmo(false)
    try {
      setPreview(await postAjuste(modal.fila._id, { accion: modal.accion, fecha, apply: false }))
    } catch (e: any) {
      setModalError(e?.message || 'No se pudo calcular el efecto')
    } finally {
      setTrabajando(false)
    }
  }

  const aplicar = async () => {
    if (!modal || !preview) return
    setTrabajando(true); setModalError(null)
    try {
      const r = await postAjuste(modal.fila._id, { accion: modal.accion, fecha, motivo, apply: true })
      const c = r.cursos || []
      if (modal.accion === 'cierre') {
        const clases = c.reduce((s: number, x: any) => s + (x.clasesBorra || 0), 0)
        setAviso(`Curso cerrado: se quitaron ${clases} clase(s). Pasa a Cerrado desde el ${r.cerradoDesde}.`)
      } else {
        const clases = c.reduce((s: number, x: any) => s + (x.clasesNuevas || 0), 0)
        const ag = c.reduce((s: number, x: any) => s + (x.agendamientos || 0), 0)
        const sinLec = c.reduce((s: number, x: any) => s + (x.sinLeccion || 0), 0)
        const fall = c.flatMap((x: any) => x.fallidos || [])
        setAviso(`Curso ampliado hasta el ${r.nuevoFinal}: ${clases} clase(s) nueva(s) y ${ag} agendamiento(s).`
          + (sinLec ? ` ${sinLec} clase(s) quedaron sin lección porque el currículo no alcanza.` : '')
          + (fall.length ? ` No se pudo agendar a: ${fall.join(', ')}.` : ''))
      }
      setModal(null)
      await cargar()
      onAjustado?.()
    } catch (e: any) {
      setModalError(e?.message || 'No se pudo aplicar el ajuste')
    } finally {
      setTrabajando(false)
    }
  }

  const listo = !!preview && confirmo && motivo.trim().length > 0 && !trabajando

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aj-campana">Campaña</label>
            <select id="aj-campana" value={campaign} onChange={e => setCampaign(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[240px] focus:ring-2 focus:ring-primary-500">
              <option value="">Selecciona una campaña…</option>
              {campanias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aj-curso">Curso</label>
            <select id="aj-curso" value={curso} onChange={e => { setCurso(e.target.value); setSalon('') }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[160px] focus:ring-2 focus:ring-primary-500">
              <option value="">Todos los cursos</option>
              {cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aj-salon">Salón</label>
            <select id="aj-salon" value={salon} onChange={e => setSalon(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[120px] focus:ring-2 focus:ring-primary-500">
              <option value="">Todos</option>
              {salones.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500 max-w-3xl">
          <strong>Última clase</strong> es la fecha real de la última sesión. Suele ser posterior al Final curso porque las clases que caen en festivo se corren al final.
          Un curso cerrado o ampliado aquí ya no se puede editar desde Gestión.
        </p>
      </div>

      {aviso && (
        <div className="p-3 rounded-md text-sm bg-green-50 border border-green-200 text-green-800 flex justify-between gap-3">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="text-green-700 hover:text-green-900" aria-label="Cerrar aviso">×</button>
        </div>
      )}
      {error && <div className="p-3 rounded-md text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>}

      {/* Tabla */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">
          {campaign ? `Cursos de ${campaign} (${visibles.length}${visibles.length !== rows.length ? ` de ${rows.length}` : ''})` : 'Selecciona una campaña'}
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : !visibles.length ? (
          <p className="text-sm text-gray-500">{campaign ? 'No hay cursos con esos filtros.' : ''}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap [&_th]:font-medium">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Tipo</th><th>Salón</th><th>Guía</th><th>Horario</th><th>Inicio curso</th><th>Final curso</th>
                  <th>Última clase</th><th>Clases</th><th>Cupos</th><th>Estado</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(r => {
                  const est = estadoCurso(r)
                  const cierreProgramado = r.cierreCurso && r.cierreCurso >= hoy
                  const full = r.usuInscritos >= r.numeroUsuarios && r.numeroUsuarios > 0
                  const motivoNoCierre = r.esImpulsa
                    ? 'IMPULSA no se ajusta desde aquí: su calendario sale de su propia configuración'
                    : est === 'cerrado' ? 'El curso ya terminó'
                    : r.clasesDictadas >= r.clasesTotal ? 'No le quedan clases por dictar' : ''
                  const motivoNoAmpl = r.esImpulsa
                    ? 'IMPULSA no se ajusta desde aquí: su calendario sale de su propia configuración' : ''
                  return (
                    <tr key={r._id} className="border-b last:border-0 align-middle">
                      <td className="py-2 font-medium">{r.tipoCurso}{r.grupoHorarioId && <span className="ml-1 text-primary-600" title="Comparte clases con otro salón: se ajustan juntos">🔗</span>}</td>
                      <td>{r.salon || '—'}</td>
                      <td className="max-w-[220px] truncate" title={r.guiaNombre || ''}>{r.guiaNombre || <span className="text-gray-400">Sin guía</span>}</td>
                      <td>{r.horarioCurso}</td>
                      <td>{fmt(r.inicioCurso)}</td>
                      <td>{fmt(r.finalCurso)}</td>
                      <td className={r.ultimaClase && r.finalCurso && r.ultimaClase > r.finalCurso.slice(0, 10) ? 'text-amber-700' : ''}>{fmt(r.ultimaClase)}</td>
                      <td className="tabular-nums">{r.clasesDictadas}/{r.clasesTotal}</td>
                      <td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${full ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {r.usuInscritos}/{r.numeroUsuarios}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_CURSO_META[est].cls}`}>{ESTADO_CURSO_META[est].label}</span>
                          {cierreProgramado && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-100">Cierre programado {fmt(r.cierreCurso)}</span>
                          )}
                          {r.ajustes > 0 && (
                            <button type="button" onClick={() => setHistorial(r)} className="text-[11px] text-primary-700 hover:underline">
                              Ajustado ({r.ajustes}) · historial
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <button type="button" disabled={!!motivoNoCierre} title={motivoNoCierre || 'Adelantar el final del curso'}
                          onClick={() => abrir(r, 'cierre')}
                          className="mr-2 px-2.5 py-1 rounded-md text-xs font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
                          Cierre
                        </button>
                        <button type="button" disabled={!!motivoNoAmpl} title={motivoNoAmpl || 'Extender el final del curso'}
                          onClick={() => abrir(r, 'ampliacion')}
                          className="px-2.5 py-1 rounded-md text-xs font-medium border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed">
                          Ampliación
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de ajuste */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={cerrarModal}>
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">
              {modal.accion === 'cierre' ? 'Cerrar curso' : 'Ampliar curso'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {modal.fila.campaign} · {modal.fila.tipoCurso} · Salón {modal.fila.salon || '—'} · {modal.fila.horarioCurso}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Final curso {fmt(modal.fila.finalCurso)} · última clase {fmt(modal.fila.ultimaClase)} · {modal.fila.clasesDictadas}/{modal.fila.clasesTotal} clases dictadas
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aj-fecha">
                  {modal.accion === 'cierre' ? 'Última clase que se dicta' : 'Nuevo Final curso'}
                </label>
                <input id="aj-fecha" type="date" value={fecha}
                  min={modal.accion === 'cierre' ? hoy : (modal.fila.finalCurso ? addDaysISO(modal.fila.finalCurso, 1) : undefined)}
                  max={modal.accion === 'cierre' && modal.fila.ultimaClase ? modal.fila.ultimaClase : undefined}
                  onChange={e => { setFecha(e.target.value); setPreview(null); setConfirmo(false) }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500" />
                <p className="text-xs text-gray-500 mt-1">
                  {modal.accion === 'cierre'
                    ? 'Se quitan las clases posteriores a esta fecha. Sólo se pueden quitar clases que todavía no ocurren.'
                    : 'Se agregan las clases que faltan hasta esta fecha, después de la última existente, saltando festivos y suspensiones.'}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="aj-motivo">Motivo <span className="text-red-600">*</span></label>
                <textarea id="aj-motivo" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500"
                  placeholder={modal.accion === 'cierre' ? 'Por qué se cierra antes de tiempo' : 'Por qué se extiende el curso'} />
              </div>

              <button type="button" onClick={verEfecto} disabled={!fecha || trabajando}
                className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {trabajando && !preview ? 'Calculando…' : 'Ver efecto'}
              </button>

              {modalError && <div className="p-3 rounded-md text-sm bg-red-50 border border-red-200 text-red-700">{modalError}</div>}

              {preview && (
                <div className={`rounded-lg border p-4 text-sm space-y-3 ${modal.accion === 'cierre' ? 'border-red-200 bg-red-50' : 'border-primary-200 bg-primary-50'}`}>
                  {preview.cursos.length > 1 && (
                    <p className="text-gray-800">Este salón comparte clases con otro: <strong>se ajustan juntos</strong>.</p>
                  )}
                  {preview.cursos.map((c: any) => (
                    <div key={c._id} className="text-gray-800">
                      <p className="font-semibold">{c.nombre}</p>
                      {modal.accion === 'cierre' ? (
                        <p>
                          Se eliminan <strong>{c.clasesBorra} clase(s)</strong> (desde el {c.primeraBorrada}) y <strong>{c.agendamientos} agendamiento(s)</strong> de {c.alumnos} alumno(s).
                          {' '}Quedan {c.clasesQuedan} clases; la última será el <strong>{c.ultimaNueva || '—'}</strong>.
                        </p>
                      ) : (
                        <p>
                          Se agregan <strong>{c.clasesNuevas} clase(s)</strong>, del {c.desde} al {c.hasta}, y se agenda a <strong>{c.alumnos} alumno(s)</strong>.
                          {' '}Final curso: {c.finalAntes || '—'} → <strong>{preview.nuevoFinal}</strong>.
                          {c.cierreAntes && <> Se levanta el cierre del {c.cierreAntes}.</>}
                          {c.omitidasPasadas > 0 && <> {c.omitidasPasadas} fecha(s) ya pasadas no se crean.</>}
                        </p>
                      )}
                    </div>
                  ))}
                  {modal.accion === 'cierre' ? (
                    <p className="text-gray-700">
                      El curso pasa a <strong>Cerrado desde el {preview.cerradoDesde}</strong>
                      {preview.cursos[0]?.guiaNombre ? <> y <strong>{preview.cursos[0].guiaNombre}</strong> queda libre para otro curso desde ese día</> : null}.
                      {' '}Las clases ya dictadas no se tocan.
                    </p>
                  ) : (
                    <p className="text-gray-700">
                      Las clases nuevas continúan la secuencia de lecciones; las existentes no cambian. Los alumnos que aún no están aprobados recibirán sus clases al aprobarse.
                    </p>
                  )}
                  <p className="text-gray-700">Después de esto el curso ya no se podrá editar desde Gestión.</p>
                  <label className="flex items-start gap-2 text-gray-800">
                    <input type="checkbox" checked={confirmo} onChange={e => setConfirmo(e.target.checked)} className="mt-0.5" />
                    <span>{modal.accion === 'cierre' ? 'Confirmo que se eliminen esas clases y agendamientos.' : 'Confirmo la ampliación.'}</span>
                  </label>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={cerrarModal} disabled={trabajando}
                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={aplicar} disabled={!listo}
                className={`px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-40 ${modal.accion === 'cierre' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}>
                {trabajando && preview ? 'Aplicando…' : modal.accion === 'cierre' ? 'Aplicar cierre' : 'Aplicar ampliación'}
              </button>
            </div>
            {preview && !motivo.trim() && <p className="text-xs text-gray-500 text-right mt-2">Escribe el motivo para poder aplicar.</p>}
          </div>
        </div>
      )}

      {/* Historial de ajustes */}
      {historial && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setHistorial(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Historial de ajustes</h3>
            <p className="text-sm text-gray-600 mt-1">{historial.tipoCurso} · Salón {historial.salon || '—'} · {historial.horarioCurso}</p>
            <ul className="mt-4 space-y-3">
              {[...(historial.ajustesHistory || [])].reverse().map((h: any, i: number) => (
                <li key={i} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className={`font-semibold ${h.tipo === 'CIERRE' ? 'text-red-700' : 'text-primary-700'}`}>{h.tipo === 'CIERRE' ? 'Cierre' : 'Ampliación'}</span>
                    <span className="text-xs text-gray-500">{h.fecha ? new Date(h.fecha).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-gray-700 mt-1">Final curso: {h.finalAnterior || '—'} → {h.finalNuevo}. Última clase: {h.ultimaClaseAnterior || '—'} → {h.ultimaClaseNueva || '—'}.</p>
                  <p className="text-gray-700">
                    {h.tipo === 'CIERRE'
                      ? `${h.clasesEliminadas} clase(s) y ${h.agendamientosEliminados} agendamiento(s) eliminados.`
                      : `${h.clasesAgregadas} clase(s) agregadas para ${h.alumnos} alumno(s).`}
                    {h.guiaNombre ? ` Guía: ${h.guiaNombre}.` : ''}
                  </p>
                  <p className="text-gray-600 mt-1"><span className="text-gray-500">Motivo:</span> {h.motivo}</p>
                  <p className="text-xs text-gray-500 mt-1">{h.realizadoPorNombre || ''} {h.realizadoPor ? `(${h.realizadoPor})` : ''}</p>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setHistorial(null)} className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
