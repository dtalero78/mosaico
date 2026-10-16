'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { usePermissions } from '@/hooks/usePermissions'
import { ServicioPermission } from '@/types/permissions'
import { exportToExcel } from '@/lib/export-excel'
import { fillTemplate } from '@/lib/message-template-filler'
import { etiquetaOrigenTaller, MAX_RECORDATORIOS } from '@/lib/taller'
import { hoyEnChile } from '@/lib/cursos-campaign'

interface Row {
  bookingId: string
  origen: string | null
  eventoId: string
  dia: string
  nombreEvento: string | null
  tituloONivel: string | null
  limiteUsuarios: number | null
  guia: string | null
  academicaId: string
  numeroId: string | null
  primerNombre: string | null
  primerApellido: string | null
  nombre: string | null
  contrato: string | null
  campaign: string | null
  tipoCurso: string | null
  salon: string | null
  apoderado: string | null
  asistio: boolean
  telefono: string | null
  esApoderado: boolean
  telefonoValido: boolean
  recordatorioEn: string | null
  recordatorioTelefono: string | null
  recordatorioPor: string | null
  fechaTaller: string
  horaTaller: string
}
interface Plantilla { nombre: string; contenido: string; activo: boolean }
interface Resultado { bookingId: string; nombre: string; telefono: string | null; ok: boolean; error?: string }

type Modo = 'proximos' | 'historico'

/** Hoy y hace un mes, en Chile: el período por defecto del Histórico. */
function ultimoMes() {
  const hasta = hoyEnChile()
  const [y, m, d] = hasta.split('-').map(Number)
  const desde = new Date(Date.UTC(y, m - 2, d)).toISOString().slice(0, 10)
  return { desde, hasta }
}

const fmtDiaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function TalleresTab({ modo, onCount }: { modo: Modo; onCount?: (n: number) => void }) {
  const esProximos = modo === 'proximos'
  const inicial = esProximos ? { desde: '', hasta: '' } : ultimoMes()
  const { hasPermission } = usePermissions()
  const puedeEnviar = esProximos && hasPermission(ServicioPermission.TALLERES_ENVIAR as any)

  const [usuario, setUsuario] = useState('')
  const [campaign, setCampaign] = useState('')
  const [curso, setCurso] = useState('')
  const [salon, setSalon] = useState('')
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)

  const [rows, setRows] = useState<Row[]>([])
  const [opciones, setOpciones] = useState<{ campaigns: string[]; cursos: string[]; salones: string[] }>({ campaigns: [], cursos: [], salones: [] })
  const [plantilla, setPlantilla] = useState<Plantilla | null>(null)
  const [loading, setLoading] = useState(true)

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: number; resultados: Resultado[] } | null>(null)

  // En un ref: si la página pasa una función nueva en cada render, `cargar`
  // cambiaría y el efecto de abajo volvería a cargar sin fin.
  const onCountRef = useRef(onCount)
  onCountRef.current = onCount

  const cargar = useCallback(async (f: Record<string, string>) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ modo })
      Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v) })
      const r = await fetch(`/api/postgres/servicio/talleres?${qs}`, { cache: 'no-store' }).then(x => x.json())
      if (!r.success) throw new Error(r.error || 'Error al cargar')
      setRows(r.rows || [])
      setOpciones({ campaigns: r.campaigns || [], cursos: r.cursos || [], salones: r.salones || [] })
      setPlantilla(r.plantilla || null)
      setSeleccion(new Set())
      onCountRef.current?.((r.rows || []).length)
    } catch (e: any) {
      toast.error(e?.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [modo])

  const filtros = () => ({ usuario: usuario.trim(), campaign, curso, salon, desde, hasta })
  useEffect(() => { cargar({ desde: inicial.desde, hasta: inicial.hasta }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargar])

  const aplicar = () => cargar(filtros())
  const borrar = () => {
    setUsuario(''); setCampaign(''); setCurso(''); setSalon('')
    setDesde(inicial.desde); setHasta(inicial.hasta)
    cargar({ desde: inicial.desde, hasta: inicial.hasta })
  }

  // Curso del ALUMNO → taller → inscritos, respetando el orden del servidor.
  const grupos = useMemo(() => {
    const porCurso = new Map<string, Map<string, Row[]>>()
    for (const r of rows) {
      const c = r.tipoCurso || '— Sin curso —'
      if (!porCurso.has(c)) porCurso.set(c, new Map())
      const talleres = porCurso.get(c)!
      if (!talleres.has(r.eventoId)) talleres.set(r.eventoId, [])
      talleres.get(r.eventoId)!.push(r)
    }
    return Array.from(porCurso.entries()).map(([c, t]) => [c, Array.from(t.values())] as const)
  }, [rows])

  const enviables = useMemo(() => rows.filter(r => r.telefonoValido), [rows])
  const seleccionadas = useMemo(() => rows.filter(r => seleccion.has(r.bookingId)), [rows, seleccion])
  const yaEnviados = seleccionadas.filter(r => r.recordatorioEn).length

  const alternar = (ids: string[], marcar: boolean) => setSeleccion(prev => {
    const s = new Set(prev)
    ids.forEach(id => (marcar ? s.add(id) : s.delete(id)))
    return s
  })

  const enviar = async () => {
    setEnviando(true)
    try {
      const r = await fetch('/api/postgres/servicio/talleres/recordatorio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingIds: seleccionadas.map(x => x.bookingId) }),
      }).then(x => x.json())
      if (!r.success) throw new Error(r.error || 'No se pudo enviar')
      setConfirmar(false)
      setResultado({ enviados: r.enviados, fallidos: r.fallidos, resultados: r.resultados || [] })
      cargar(filtros())
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar', { duration: 8000 })
    } finally {
      setEnviando(false)
    }
  }

  const exportar = () => {
    exportToExcel(rows, [
      { header: 'Fecha', accessor: r => r.fechaTaller },
      { header: 'Hora (Chile)', accessor: r => r.horaTaller },
      { header: 'Taller', accessor: r => r.nombreEvento || r.tituloONivel || '' },
      { header: 'Guía', accessor: r => r.guia || '' },
      { header: 'Curso', accessor: r => r.tipoCurso || '' },
      { header: 'Campaña', accessor: r => r.campaign || '' },
      { header: 'Salón', accessor: r => r.salon || '' },
      { header: 'Nombre', accessor: r => r.nombre || '' },
      { header: 'ID', accessor: r => r.numeroId || '' },
      { header: 'Contrato', accessor: r => r.contrato || '' },
      { header: 'Apoderado', accessor: r => r.apoderado || '' },
      { header: 'Origen', accessor: r => etiquetaOrigenTaller(r.origen) },
      esProximos
        ? { header: 'Recordatorio', accessor: r => (r.recordatorioEn ? `Enviado ${fmtDiaHora(r.recordatorioEn)}` : '') }
        : { header: 'Asistencia', accessor: r => (r.asistio ? 'Asistió' : 'No asistió') },
    ], esProximos ? 'talleres-proximos' : 'talleres-historico')
  }

  const vistaPrevia = seleccionadas[0] && plantilla
    ? fillTemplate(plantilla.contenido, {
        nombre: seleccionadas[0].primerNombre, primerApellido: seleccionadas[0].primerApellido,
        numeroId: seleccionadas[0].numeroId, contrato: seleccionadas[0].contrato,
        apoderado: seleccionadas[0].apoderado, curso: seleccionadas[0].tipoCurso,
        fechaTaller: seleccionadas[0].fechaTaller, horaTaller: seleccionadas[0].horaTaller,
      })
    : ''

  const sel = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm'

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <label htmlFor={`${modo}-usuario`} className="block text-xs font-medium text-gray-500 mb-1">Nombre, ID o contrato</label>
            <input id={`${modo}-usuario`} type="text" value={usuario} onChange={e => setUsuario(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicar() }} placeholder="Buscar…" className={sel} />
          </div>
          <div>
            <label htmlFor={`${modo}-campaign`} className="block text-xs font-medium text-gray-500 mb-1">Campaña</label>
            <select id={`${modo}-campaign`} value={campaign} onChange={e => setCampaign(e.target.value)} className={sel}>
              <option value="">Todas</option>{opciones.campaigns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${modo}-curso`} className="block text-xs font-medium text-gray-500 mb-1">Curso</label>
            <select id={`${modo}-curso`} value={curso} onChange={e => setCurso(e.target.value)} className={sel}>
              <option value="">Todos</option>{opciones.cursos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${modo}-salon`} className="block text-xs font-medium text-gray-500 mb-1">Salón</label>
            <select id={`${modo}-salon`} value={salon} onChange={e => setSalon(e.target.value)} className={sel}>
              <option value="">Todos</option>{opciones.salones.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:col-span-3 lg:col-span-1 lg:grid-cols-1">
            <div>
              <label htmlFor={`${modo}-desde`} className="block text-xs font-medium text-gray-500 mb-1">Fecha inicial</label>
              <input id={`${modo}-desde`} type="date" value={desde} onChange={e => setDesde(e.target.value)} className={sel} />
            </div>
            <div>
              <label htmlFor={`${modo}-hasta`} className="block text-xs font-medium text-gray-500 mb-1">Fecha final</label>
              <input id={`${modo}-hasta`} type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={sel} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={aplicar} disabled={loading}
            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium">Aplicar filtros</button>
          <button type="button" onClick={borrar}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Borrar filtros</button>
          <PermissionGuard permission={ServicioPermission.TALLERES_EXPORTAR as any}>
            <button type="button" onClick={exportar} disabled={!rows.length}
              className="px-3 py-2 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 font-medium">Exportar CSV</button>
          </PermissionGuard>
          <span className="ml-auto text-sm text-gray-500">
            Inscritos: <span className="font-semibold text-gray-700">{rows.length}</span>
          </span>
        </div>
      </div>

      {puedeEnviar && !loading && enviables.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4">
          <label className="inline-flex items-center gap-2 text-sm text-emerald-900 cursor-pointer">
            <input type="checkbox"
              checked={enviables.every(r => seleccion.has(r.bookingId))}
              onChange={e => alternar(enviables.map(r => r.bookingId), e.target.checked)}
              className="rounded border-emerald-400 text-emerald-600" />
            Marcar todos los visibles con teléfono ({enviables.length})
          </label>
          {!plantilla && <span className="text-xs text-red-600">No existe la plantilla «Recordatorio Taller».</span>}
          {plantilla && !plantilla.activo && <span className="text-xs text-red-600">La plantilla «{plantilla.nombre}» está inactiva.</span>}
          <button type="button" onClick={() => setConfirmar(true)}
            disabled={!seleccionadas.length || seleccionadas.length > MAX_RECORDATORIOS || !plantilla?.activo}
            className="ml-auto px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            Enviar recordatorio ({seleccionadas.length})
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">Cargando…</div>
      ) : grupos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
          {esProximos ? 'No hay talleres próximos con inscritos' : 'No hay talleres realizados en el período'}
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(([cursoNombre, talleres]) => (
            <div key={cursoNombre}>
              <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide mb-2">
                {cursoNombre}
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700 normal-case">
                  {talleres.length} taller(es)
                </span>
              </h3>
              <div className="space-y-3">
                {talleres.map(inscritos => {
                  const t = inscritos[0]
                  const asistieron = inscritos.filter(r => r.asistio).length
                  const idsEnviables = inscritos.filter(r => r.telefonoValido).map(r => r.bookingId)
                  const todosMarcados = idsEnviables.length > 0 && idsEnviables.every(id => seleccion.has(id))
                  return (
                    <div key={t.eventoId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm">
                        <span className="font-semibold text-gray-900 capitalize">{t.fechaTaller}</span>
                        <span className="text-gray-700">{t.horaTaller} <span className="text-xs text-gray-400">(hora Chile)</span></span>
                        <span className="text-gray-600">Taller {t.nombreEvento || t.tituloONivel || ''}</span>
                        {t.guia && <span className="text-gray-500">Guía: {t.guia}</span>}
                        <span className="ml-auto text-gray-600">
                          {esProximos
                            ? <>{inscritos.length} inscrito(s){t.limiteUsuarios ? ` · cupo ${t.limiteUsuarios}` : ''}</>
                            : <><span className="font-semibold">{asistieron}</span> de {inscritos.length} asistieron</>}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b border-gray-100">
                            <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              {puedeEnviar && (
                                <th className="px-3 py-2 w-8">
                                  <input type="checkbox" checked={todosMarcados} disabled={!idsEnviables.length}
                                    onChange={e => alternar(idsEnviables, e.target.checked)}
                                    aria-label="Marcar todos los inscritos de este taller"
                                    className="rounded border-gray-300 text-emerald-600" />
                                </th>
                              )}
                              {['Nombre', 'ID', 'Contrato', 'Campaña', 'Salón', 'Apoderado',
                                ...(esProximos ? ['Envía a', 'Origen', 'Recordatorio'] : ['Origen', 'Asistencia'])].map(h => (
                                <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {inscritos.map(r => (
                              <tr key={r.bookingId} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50 ${seleccion.has(r.bookingId) ? 'bg-emerald-50' : ''}`}>
                                {puedeEnviar && (
                                  <td className="px-3 py-2">
                                    <input type="checkbox" checked={seleccion.has(r.bookingId)} disabled={!r.telefonoValido}
                                      onChange={e => alternar([r.bookingId], e.target.checked)}
                                      title={r.telefonoValido ? 'Marcar para enviar' : 'Sin teléfono válido'}
                                      aria-label={`Enviar recordatorio a ${r.nombre}`}
                                      className="rounded border-gray-300 text-emerald-600 disabled:opacity-40" />
                                  </td>
                                )}
                                <td className="px-3 py-2 font-medium whitespace-nowrap">
                                  <button type="button" onClick={() => window.open(`/student/${r.academicaId}`, '_blank', 'noopener,noreferrer')}
                                    className="text-primary-600 hover:text-primary-800 hover:underline">{r.nombre || '—'}</button>
                                </td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.numeroId || '—'}</td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.contrato || '—'}</td>
                                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{r.campaign || '—'}</td>
                                <td className="px-3 py-2 text-gray-600">{r.salon || '—'}</td>
                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.apoderado || '—'}</td>
                                {esProximos && (
                                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                                    {r.telefonoValido
                                      ? <><span className="text-gray-700">{r.telefono}</span> <span className="text-gray-400">({r.esApoderado ? 'apoderado' : 'alumno'})</span></>
                                      : <span className="text-red-600">Sin teléfono válido</span>}
                                  </td>
                                )}
                                <td className="px-3 py-2 text-xs whitespace-nowrap">
                                  <span className={r.origen?.toUpperCase() === 'PANEL_EST' ? 'text-sky-700' : 'text-gray-500'}>
                                    {etiquetaOrigenTaller(r.origen)}
                                  </span>
                                </td>
                                {esProximos ? (
                                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                                    {r.recordatorioEn
                                      ? <span className="text-emerald-700 font-medium" title={`${r.recordatorioPor ? `Por ${r.recordatorioPor} · ` : ''}a ${r.recordatorioTelefono || ''}`}>✓ Enviado {fmtDiaHora(r.recordatorioEn)}</span>
                                      : <span className="text-gray-400">—</span>}
                                  </td>
                                ) : (
                                  <td className="px-3 py-2">
                                    {r.asistio
                                      ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Asistió</span>
                                      : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">No asistió</span>}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Enviar recordatorio de taller</h3>
            <p className="text-sm text-gray-600 mb-3">
              Se enviará «{plantilla?.nombre}» por WhatsApp a <strong>{seleccionadas.length}</strong> inscrito(s),
              uno por alumno (los hermanos reciben un mensaje cada uno).
            </p>
            {yaEnviados > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                {yaEnviados} ya recibieron el recordatorio: se les enviará de nuevo.
              </p>
            )}
            <p className="text-xs font-medium text-gray-500 mb-1">Así le llegará a {seleccionadas[0]?.esApoderado ? 'el apoderado de ' : ''}{seleccionadas[0]?.nombre}:</p>
            <div className="bg-[#efeae2] rounded-lg p-3 mb-4">
              <div className="ml-auto max-w-[90%] bg-[#d9fdd3] rounded-lg rounded-tr-none px-3 py-2 shadow-sm">
                <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{vistaPrevia}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(false)} disabled={enviando}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={enviar} disabled={enviando}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {enviando ? 'Enviando…' : `Enviar (${seleccionadas.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {resultado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Resultado del envío</h3>
            <p className="text-sm mb-3">
              <span className="text-emerald-700 font-semibold">{resultado.enviados} enviado(s)</span>
              {resultado.fallidos > 0 && <> · <span className="text-red-600 font-semibold">{resultado.fallidos} fallido(s)</span></>}
            </p>
            {resultado.fallidos > 0 && (
              <ul className="border border-red-100 rounded-lg divide-y divide-red-50 mb-4 text-sm">
                {resultado.resultados.filter(x => !x.ok).map(x => (
                  <li key={x.bookingId} className="px-3 py-1.5 flex justify-between gap-3">
                    <span className="text-gray-800">{x.nombre}</span>
                    <span className="text-xs text-red-600">{x.error}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setResultado(null)}
                className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
