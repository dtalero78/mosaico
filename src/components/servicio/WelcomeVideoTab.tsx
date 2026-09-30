'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { formatDateTime } from '@/lib/utils'
import { exportToExcel } from '@/lib/export-excel'
import { ESTADO_CURSO_META, type CampanaEstado } from '@/lib/cursos-campaign'
import { coincidePersona } from '@/lib/busqueda-persona'
import { MAX_ENVIOS_VIDEO_POR_LOTE, VIDEO_WELCOME_MAX_MB, MAX_WELCOME_AGENDAMIENTOS } from '@/lib/welcome-intentos'

/**
 * Pestaña "Video Welcome": alumnos que faltaron a su SEGUNDA sesión de bienvenida
 * sin asistir a ninguna (el tope es 2, así que ya no se les reagenda). Se les
 * envía por WhatsApp el enlace al video; al enviarlo pasan de WELCOME a su curso
 * y quedan "Enviado" (se puede reenviar).
 *
 * Agrupada POR SESIÓN —la última que perdieron—, igual que Gestión de
 * Reagendamientos, con casillas por alumno, por sesión y de todo lo visible para
 * enviar en bloque. Arriba, el video vigente y (con permiso) su reemplazo.
 */

const CAMPANA_ACTUALES = '__actuales__'
const CAMPANA_TODAS = '__todas__'

interface Props {
  estadosCampana: CampanaEstado[]
  actuales: string[]
}

interface Alumno {
  academicaId: string
  primerNombre: string
  primerApellido: string
  numeroId: string
  contrato: string
  celular: string
  campaign: string
  tipoCurso: string
  cursoAcademica: string
  apoderado: string
  apoderadoTelefono: string
  fechaEvento: string
  eventoId: string
  modulo: string
  advisorNombre: string
  faltas: number
  /** Teléfono del apoderado normalizado ('' si no hay uno válido). */
  destino: string
  envios: number
  ultimoEnvio: { fecha: string; por: string; telefono: string } | null
}

interface Video {
  key: string
  nombre: string
  tamano: number | null
  subidoPor: string | null
  subidoEn: string | null
  previewUrl: string
}

interface Grupo {
  eventoId: string
  fechaEvento: string
  advisorNombre: string
  modulo: string
  filas: Alumno[]
}

type Estado = 'todos' | 'pendientes' | 'enviados'

const nombreDe = (r: Alumno) => `${r.primerNombre} ${r.primerApellido}`.trim() || '(sin nombre)'
const mb = (b?: number | null) => (b ? `${(b / 1048576).toFixed(1)} MB` : '')

export default function WelcomeVideoTab({ estadosCampana, actuales }: Props) {
  const [alumnos, setAlumnos] = useState<Alumno[]>([])
  const [video, setVideo] = useState<Video | null>(null)
  const [enlace, setEnlace] = useState('')
  const [puedeReemplazar, setPuedeReemplazar] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState<Estado>('todos')
  const [campanaFiltro, setCampanaFiltro] = useState<string>(CAMPANA_ACTUALES)

  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState<Alumno[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: number; resultados: any[] } | null>(null)

  const [subiendo, setSubiendo] = useState<number | null>(null)
  const inputVideo = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/postgres/events/welcome/video', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
      setAlumnos(data.alumnos || [])
      setVideo(data.video || null)
      setEnlace(data.enlace || '')
      setPuedeReemplazar(data.puedeReemplazar === true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setAlumnos([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const campanasEnDatos = useMemo(() => {
    const set = new Set(alumnos.map((r) => (r.campaign || '').trim()).filter(Boolean))
    const orden = new Map(estadosCampana.map((c) => [c.campaign, c.inicio || '']))
    return Array.from(set).sort((a, b) => String(orden.get(b) || '').localeCompare(String(orden.get(a) || '')))
  }, [alumnos, estadosCampana])

  const enCampana = useCallback((r: Alumno) => {
    if (campanaFiltro === CAMPANA_TODAS) return true
    const c = (r.campaign || '').trim()
    if (campanaFiltro === CAMPANA_ACTUALES) return actuales.length === 0 || actuales.includes(c)
    return c === campanaFiltro
  }, [campanaFiltro, actuales])

  const filtradas = useMemo(() => alumnos.filter((r) => {
    if (estado === 'pendientes' && r.ultimoEnvio) return false
    if (estado === 'enviados' && !r.ultimoEnvio) return false
    if (!enCampana(r)) return false
    return coincidePersona({ nombre: nombreDe(r), numeroId: r.numeroId, contrato: r.contrato }, buscar)
  }), [alumnos, estado, enCampana, buscar])

  /** Agrupado POR SESIÓN perdida (la última), como Gestión de Reagendamientos. */
  const grupos = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>()
    for (const r of filtradas) {
      const key = r.eventoId || r.fechaEvento
      const g = mapa.get(key)
      if (g) g.filas.push(r)
      else mapa.set(key, { eventoId: key, fechaEvento: r.fechaEvento, advisorNombre: r.advisorNombre, modulo: r.modulo, filas: [r] })
    }
    return Array.from(mapa.values())
  }, [filtradas])

  // Al cambiar los filtros no se conservan marcas de filas que ya no se ven.
  useEffect(() => {
    const visibles = new Set(filtradas.map((r) => r.academicaId))
    setMarcados((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visibles.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtradas])

  const enAlcance = useMemo(() => alumnos.filter(enCampana), [alumnos, enCampana])
  const pendientes = useMemo(() => enAlcance.filter((r) => !r.ultimoEnvio).length, [enAlcance])

  const alternar = (ids: string[], marcar: boolean) => setMarcados((prev) => {
    const next = new Set(prev)
    ids.forEach((id) => (marcar ? next.add(id) : next.delete(id)))
    return next
  })
  const todasVisiblesMarcadas = filtradas.length > 0 && filtradas.every((r) => marcados.has(r.academicaId))
  const seleccion = filtradas.filter((r) => marcados.has(r.academicaId))

  const enviar = async () => {
    if (!confirmar?.length) return
    setEnviando(true)
    try {
      let total = { enviados: 0, fallidos: 0, resultados: [] as any[] }
      for (let i = 0; i < confirmar.length; i += MAX_ENVIOS_VIDEO_POR_LOTE) {
        const tanda = confirmar.slice(i, i + MAX_ENVIOS_VIDEO_POR_LOTE)
        const res = await fetch('/api/postgres/events/welcome/video/enviar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ academicaIds: tanda.map((r) => r.academicaId) }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data?.error || `Error ${res.status}`)
        total = {
          enviados: total.enviados + data.enviados,
          fallidos: total.fallidos + data.fallidos,
          resultados: [...total.resultados, ...(data.resultados || [])],
        }
      }
      setResultado(total)
      setConfirmar(null)
      setMarcados(new Set())
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar')
    } finally {
      setEnviando(false)
    }
  }

  const reemplazar = async (file: File) => {
    if (file.type !== 'video/mp4') { toast.error('El video debe ser un archivo MP4.'); return }
    if (file.size > VIDEO_WELCOME_MAX_MB * 1048576) { toast.error(`El video no puede pasar de ${VIDEO_WELCOME_MAX_MB} MB.`); return }
    setSubiendo(0)
    try {
      const pre = await fetch('/api/postgres/events/welcome/video/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: file.type, tamano: file.size }),
      }).then((r) => r.json())
      if (!pre?.success) throw new Error(pre?.error || 'No se pudo preparar la subida')
      // XHR para mostrar el avance: el archivo va directo a Spaces.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', pre.url)
        xhr.setRequestHeader('Content-Type', file.type)
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setSubiendo(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Error al subir (${xhr.status})`)))
        xhr.onerror = () => reject(new Error('Error de red al subir el video'))
        xhr.send(file)
      })
      const fin = await fetch('/api/postgres/events/welcome/video/reemplazar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pre.key, nombre: file.name, tamano: file.size }),
      }).then((r) => r.json())
      if (!fin?.success) throw new Error(fin?.error || 'No se pudo registrar el video')
      toast.success('Video reemplazado. El enlace ya muestra el nuevo.')
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo reemplazar el video')
    } finally {
      setSubiendo(null)
      if (inputVideo.current) inputVideo.current.value = ''
    }
  }

  return (
    <div className="card">
      <div className="card-content space-y-6">
        {/* Video vigente */}
        <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-4 flex flex-col md:flex-row gap-4 md:items-center">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Video que se envía</p>
            {video ? (
              <>
                <p className="mt-1 text-sm font-medium text-gray-900 truncate" title={video.nombre}>{video.nombre}</p>
                <p className="text-xs text-gray-600">
                  {mb(video.tamano)}{video.subidoPor ? ` · subido por ${video.subidoPor}` : ''}{video.subidoEn ? ` · ${formatDateTime(video.subidoEn)}` : ''}
                </p>
                {enlace && (
                  <p className="mt-1 text-xs text-gray-500">
                    Enlace que recibe el usuario:{' '}
                    <a href={enlace} target="_blank" rel="noopener noreferrer" className="text-purple-700 hover:underline break-all">{enlace}</a>
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-amber-800">Aún no hay video cargado: no se puede enviar hasta subir uno.</p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Aquí llegan quienes faltaron a su {MAX_WELCOME_AGENDAMIENTOS}.ª sesión de bienvenida sin asistir a ninguna. Al enviar el video,
              el alumno pasa de WELCOME a su curso. El mensaje va siempre al teléfono del apoderado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            {video?.previewUrl && (
              <a href={video.previewUrl} target="_blank" rel="noopener noreferrer"
                className="px-3 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-300 rounded-md hover:bg-purple-50">
                ▶ Ver video
              </a>
            )}
            {puedeReemplazar && (
              <>
                <input ref={inputVideo} type="file" accept="video/mp4" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) reemplazar(f) }} />
                <button type="button" onClick={() => inputVideo.current?.click()} disabled={subiendo !== null}
                  className="px-3 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-60">
                  {subiendo !== null ? `Subiendo… ${subiendo}%` : video ? 'Reemplazar video' : 'Subir video'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label htmlFor="vwCampana" className="block text-sm font-medium text-gray-700 mb-1">Campaña</label>
              <select id="vwCampana" value={campanaFiltro} onChange={(e) => setCampanaFiltro(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm">
                <option value={CAMPANA_ACTUALES}>Actuales{actuales.length ? ` (${actuales.join(' + ')})` : ''}</option>
                <option value={CAMPANA_TODAS}>Todas</option>
                {campanasEnDatos.map((c) => {
                  const est = estadosCampana.find((e) => e.campaign === c)
                  return <option key={c} value={c}>{c}{est ? ` — ${ESTADO_CURSO_META[est.estado].label}` : ''}</option>
                })}
              </select>
            </div>
            <div>
              <label htmlFor="vwBuscar" className="block text-sm font-medium text-gray-700 mb-1">Nombre, ID o contrato</label>
              <input id="vwBuscar" type="text" value={buscar} onChange={(e) => setBuscar(e.target.value)}
                placeholder="Nombre, documento o contrato..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm" />
            </div>
            <div>
              <label htmlFor="vwEstado" className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select id="vwEstado" value={estado} onChange={(e) => setEstado(e.target.value as Estado)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm">
                <option value="todos">Todos</option>
                <option value="pendientes">Pendientes de envío</option>
                <option value="enviados">Enviados</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button"
                onClick={() => { setBuscar(''); setEstado('todos'); setCampanaFiltro(CAMPANA_ACTUALES) }}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Limpiar
              </button>
              <button type="button" disabled={filtradas.length === 0}
                onClick={() => exportToExcel(filtradas, [
                  { header: 'Nombre', accessor: (r) => nombreDe(r) },
                  { header: 'ID', accessor: (r) => r.numeroId || '' },
                  { header: 'Contrato', accessor: (r) => r.contrato || '' },
                  { header: 'Campaña', accessor: (r) => r.campaign || '' },
                  { header: 'Curso', accessor: (r) => r.tipoCurso || '' },
                  { header: 'Faltas WELCOME', accessor: (r) => r.faltas },
                  { header: 'Última sesión perdida', accessor: (r) => formatDateTime(r.fechaEvento) },
                  { header: 'Apoderado', accessor: (r) => r.apoderado || '' },
                  { header: 'Teléfono apoderado', accessor: (r) => r.destino || 'sin teléfono' },
                  { header: 'Estado', accessor: (r) => (r.ultimoEnvio ? `Enviado ${formatDateTime(r.ultimoEnvio.fecha)}` : 'Pendiente') },
                ], `welcome-video-${new Date().toISOString().split('T')[0]}`)}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md disabled:opacity-50">
                Excel
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={todasVisiblesMarcadas} disabled={filtradas.length === 0}
                onChange={() => alternar(filtradas.map((r) => r.academicaId), !todasVisiblesMarcadas)}
                className="h-4 w-4 rounded border-gray-300 text-purple-600" />
              Marcar todos los visibles
            </label>
            <span className="text-sm text-gray-600">
              {loading ? 'Cargando…' : `Mostrando ${filtradas.length} de ${enAlcance.length} alumno(s) · ${pendientes} sin enviar · ${grupos.length} sesión(es)`}
            </span>
            <button type="button" disabled={!seleccion.length || !video}
              onClick={() => setConfirmar(seleccion)}
              title={!video ? 'Sube el video antes de enviarlo' : undefined}
              className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50">
              Enviar video ({seleccion.length})
            </button>
          </div>
        </div>

        {error ? (
          <div className="alert alert-error"><div className="ml-3 text-sm text-red-700">{error}</div></div>
        ) : grupos.length === 0 && !loading ? (
          <div className="text-center py-10 text-gray-500">
            <h3 className="text-sm font-medium text-gray-900">No hay alumnos para enviar el video</h3>
            <p className="mt-1 text-sm">
              {enAlcance.length > 0 ? 'Nadie cumple con esos filtros.' : `Nadie ha faltado a sus ${MAX_WELCOME_AGENDAMIENTOS} sesiones de bienvenida.`}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => {
              const ids = g.filas.map((f) => f.academicaId)
              const todas = ids.every((id) => marcados.has(id))
              const sinEnviar = g.filas.filter((f) => !f.ultimoEnvio).length
              return (
                <div key={g.eventoId} className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-purple-50 border-b flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm inline-flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={todas} onChange={() => alternar(ids, !todas)}
                        className="h-4 w-4 rounded border-gray-300 text-purple-600" />
                      <span>
                        <span className="font-semibold text-purple-900">{formatDateTime(g.fechaEvento)}</span>
                        <span className="text-purple-700"> · {g.advisorNombre || 'Sin guía'}</span>
                        {g.modulo ? <span className="text-purple-700"> · {g.modulo}</span> : null}
                      </span>
                    </label>
                    <span className="text-xs font-medium text-purple-800 bg-purple-100 px-2 py-1 rounded-full">
                      {g.filas.length} alumno(s) · {sinEnviar} sin enviar
                    </span>
                  </div>
                  <div className="table-container">
                    <table className="table [&_th]:!px-3 [&_td]:!px-3">
                      <thead className="table-header">
                        <tr>
                          <th className="table-header-cell w-10"></th>
                          <th className="table-header-cell">Alumno</th>
                          <th className="table-header-cell">ID</th>
                          <th className="table-header-cell">Campaña · Curso</th>
                          <th className="table-header-cell">Apoderado</th>
                          <th className="table-header-cell">Estado</th>
                          <th className="table-header-cell text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="table-body">
                        {g.filas.map((r) => (
                          <tr key={r.academicaId} className="hover:bg-gray-50">
                            <td className="table-cell">
                              <input type="checkbox" checked={marcados.has(r.academicaId)}
                                onChange={() => alternar([r.academicaId], !marcados.has(r.academicaId))}
                                className="h-4 w-4 rounded border-gray-300 text-purple-600" />
                            </td>
                            <td className="table-cell !whitespace-normal min-w-[220px]">
                              <a href={`/student/${r.academicaId}`} target="_blank" rel="noopener noreferrer"
                                className="text-sm font-medium text-blue-600 hover:underline">{nombreDe(r)}</a>
                              <div className="text-[11px] text-gray-500">
                                Faltó a {r.faltas} bienvenidas
                                {String(r.cursoAcademica).toUpperCase() === 'WELCOME' && <span className="text-amber-700"> · en WELCOME, pasa a su curso al enviar</span>}
                              </div>
                            </td>
                            <td className="table-cell text-sm text-gray-500">
                              <div>{r.numeroId || '—'}</div>
                              {r.contrato ? <div className="text-xs text-gray-400">{r.contrato}</div> : null}
                            </td>
                            <td className="table-cell text-sm text-gray-500">
                              <div>{r.tipoCurso || '—'}</div>
                              <div className="text-xs text-gray-400">{r.campaign || '—'}</div>
                            </td>
                            <td className="table-cell text-sm text-gray-500">
                              <div className="text-gray-900">{r.apoderado || '(sin nombre)'}</div>
                              <div className={`text-xs ${r.destino ? 'text-gray-400' : 'text-red-600'}`}>{r.destino || 'sin teléfono'}</div>
                            </td>
                            <td className="table-cell">
                              {r.ultimoEnvio ? (
                                <span className="badge badge-success" title={`Por ${r.ultimoEnvio.por} a ${r.ultimoEnvio.telefono}${r.envios > 1 ? ` · ${r.envios} envíos` : ''}`}>
                                  ✓ Enviado {formatDateTime(r.ultimoEnvio.fecha)}
                                </span>
                              ) : (
                                <span className="badge badge-warning">Pendiente</span>
                              )}
                            </td>
                            <td className="table-cell text-right">
                              <button type="button" disabled={!video || !r.destino} onClick={() => setConfirmar([r])}
                                title={!r.destino ? 'El apoderado no tiene teléfono: complétalo en la ficha del alumno' : undefined}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50">
                                {r.ultimoEnvio ? 'Reenviar' : 'Enviar video'}
                              </button>
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

      {/* Confirmación del envío */}
      {confirmar && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                Enviar el video de bienvenida a {confirmar.length} alumno(s)
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                Sale un WhatsApp al apoderado con el enlace al video. Quien siga en WELCOME pasa a su curso real.
              </p>
            </div>
            <ul className="px-6 py-3 max-h-64 overflow-y-auto divide-y text-sm">
              {confirmar.map((r) => (
                <li key={r.academicaId} className="py-1.5 flex justify-between gap-3">
                  <span className="text-gray-900">{nombreDe(r)}</span>
                  <span className="text-gray-500 text-xs">{r.apoderado || 'Apoderado'} · {r.destino || 'sin teléfono'}{r.ultimoEnvio ? ' · reenvío' : ''}</span>
                </li>
              ))}
            </ul>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)} disabled={enviando}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={enviar} disabled={enviando}
                className="px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50">
                {enviando ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {resultado.enviados} enviado(s){resultado.fallidos ? ` · ${resultado.fallidos} con error` : ''}
              </h3>
            </div>
            <ul className="px-6 py-3 divide-y text-sm">
              {resultado.resultados.map((r: any) => (
                <li key={r.academicaId} className="py-1.5">
                  <span className={r.ok ? 'text-green-700' : 'text-red-700'}>{r.ok ? '✓' : '✗'} {r.nombre}</span>
                  {r.ok && r.promovido && <span className="text-xs text-gray-500"> · pasó a su curso</span>}
                  {(r.error || r.aviso) && <div className="text-xs text-gray-500">{r.error || r.aviso}</div>}
                </li>
              ))}
            </ul>
            <div className="px-6 py-4 border-t flex justify-end">
              <button type="button" onClick={() => setResultado(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
