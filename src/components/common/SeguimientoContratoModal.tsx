'use client'

/**
 * Seguimiento del contrato: bitácora de todo lo que le pasó al contrato y a sus personas
 * (matrícula, documentos, firma, aprobación, beneficiarios, pagos y recaudos, vigencia,
 * académico, Kids, comentarios), con quién y cuándo. Se abre con un botón y carga solo al
 * abrirse (no frena la ficha ni el Libro). Fuente: GET /api/postgres/people/[id]/seguimiento
 * (services/seguimiento-contrato.service.ts). Permiso PERSON.INFO.SEGUIMIENTO.
 * Usado en la ficha del titular (/person/[id]) y en el detalle del Libro de Producción.
 */

import { useEffect, useMemo, useState } from 'react'
import { XMarkIcon, MagnifyingGlassIcon, ArrowPathIcon, ClockIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { api, handleApiError } from '@/hooks/use-api'
import { usePermissions } from '@/hooks/usePermissions'
import { PersonPermission } from '@/types/permissions'

interface Evento {
  id: string; fecha: string; soloFecha?: boolean; categoria: string; accion: string; detalle?: string | null
  usuario?: string | null; usuarioEmail?: string | null; personaId?: string | null; personaNombre?: string | null
  tipoUsuario?: string | null; cambios?: Record<string, { antes: any; despues: any }> | null
  etiqueta?: Etiqueta | null
}
type Etiqueta = 'SOBRE_APROBACION' | 'PARA_APROBACION'
interface Seguimiento {
  titularId: string; contrato: string | null
  personas: { _id: string; nombre: string; tipoUsuario: string | null }[]
  eventos: Evento[]
  etiquetasPermitidas?: Etiqueta[]
}

/** Etiquetas resaltadas de los comentarios: Aprobación escribe "Sobre la aprobación"; Comercial, "Para aprobación". */
const ETIQUETAS: Record<Etiqueta, { l: string; quien: string; badge: string; fila: string; chip: string }> = {
  SOBRE_APROBACION: { l: 'Sobre la aprobación', quien: 'Aprobación', badge: 'bg-emerald-600 text-white', fila: 'bg-emerald-50 ring-1 ring-emerald-200', chip: 'bg-emerald-600 text-white' },
  PARA_APROBACION:  { l: 'Para aprobación',     quien: 'Comercial',  badge: 'bg-amber-500 text-white',   fila: 'bg-amber-50 ring-1 ring-amber-200',     chip: 'bg-amber-500 text-white' },
}

const CATEGORIAS: Record<string, { l: string; chip: string; dot: string }> = {
  MATRICULA:     { l: 'Matrícula',     chip: 'bg-sky-100 text-sky-800',         dot: 'bg-sky-600' },
  DOCUMENTOS:    { l: 'Documentos',    chip: 'bg-slate-100 text-slate-700',     dot: 'bg-slate-500' },
  FIRMA:         { l: 'Firma',         chip: 'bg-indigo-100 text-indigo-800',   dot: 'bg-indigo-600' },
  APROBACION:    { l: 'Aprobación',    chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600' },
  BENEFICIARIOS: { l: 'Beneficiarios', chip: 'bg-teal-100 text-teal-800',       dot: 'bg-teal-600' },
  PAGOS:         { l: 'Pagos',         chip: 'bg-green-100 text-green-800',     dot: 'bg-green-600' },
  RECAUDOS:      { l: 'Recaudos',      chip: 'bg-orange-100 text-orange-800',   dot: 'bg-orange-500' },
  VIGENCIA:      { l: 'Vigencia',      chip: 'bg-amber-100 text-amber-800',     dot: 'bg-amber-500' },
  ACADEMICO:     { l: 'Académico',     chip: 'bg-violet-100 text-violet-800',   dot: 'bg-violet-600' },
  CUPO:          { l: 'Cupo',          chip: 'bg-cyan-100 text-cyan-800',       dot: 'bg-cyan-600' },
  KIDS:          { l: 'Kids',          chip: 'bg-fuchsia-100 text-fuchsia-800', dot: 'bg-fuchsia-600' },
  COMENTARIO:    { l: 'Comentario',    chip: 'bg-gray-100 text-gray-700',       dot: 'bg-gray-400' },
}

const fmtFecha = (e: Evento) => {
  const d = new Date(e.fecha)
  if (e.soloFecha) {
    const [y, m, dd] = e.fecha.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, dd).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const valor = (v: any) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function SeguimientoContratoModal({ personaId, onClose }: { personaId: string; onClose: () => void }) {
  const [data, setData] = useState<Seguimiento | null>(null)
  const [loading, setLoading] = useState(true)
  const [cats, setCats] = useState<string[]>([])
  const [persona, setPersona] = useState('')
  const [buscar, setBuscar] = useState('')

  const cargar = async () => {
    setLoading(true)
    try {
      setData(await api.get<Seguimiento>(`/api/postgres/people/${encodeURIComponent(personaId)}/seguimiento`))
    } catch (e) {
      handleApiError(e, 'No se pudo cargar el seguimiento')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [personaId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const [tags, setTags] = useState<Etiqueta[]>([])
  const conteo = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of data?.eventos || []) {
      m[e.categoria] = (m[e.categoria] || 0) + 1
      if (e.etiqueta) m[e.etiqueta] = (m[e.etiqueta] || 0) + 1
    }
    return m
  }, [data])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (data?.eventos || []).filter(e =>
      (!cats.length || cats.includes(e.categoria)) &&
      (!tags.length || (e.etiqueta && tags.includes(e.etiqueta))) &&
      (!persona || e.personaId === persona) &&
      (!q || [e.accion, e.detalle, e.usuario, e.personaNombre, e.etiqueta && ETIQUETAS[e.etiqueta]?.l]
        .some(x => x && String(x).toLowerCase().includes(q))))
  }, [data, cats, tags, persona, buscar])

  // ── Comentar (permiso PERSON.INFO.SEGUIMIENTO_COMENTAR) ──
  const { hasPermission } = usePermissions()
  const puedeComentar = hasPermission(PersonPermission.SEGUIMIENTO_COMENTAR as any)
  const [comentario, setComentario] = useState('')
  const [sobre, setSobre] = useState('')
  const [etiqueta, setEtiqueta] = useState<Etiqueta | ''>('')
  const permitidas = data?.etiquetasPermitidas || []
  const [enviando, setEnviando] = useState(false)
  const comentar = async () => {
    setEnviando(true)
    try {
      setData(await api.post<Seguimiento>(`/api/postgres/people/${encodeURIComponent(personaId)}/seguimiento`,
        { texto: comentario, personaId: sobre || undefined, etiqueta: etiqueta || undefined }))
      setComentario('')
      setEtiqueta('')
      toast.success('Comentario agregado')
    } catch (e) {
      handleApiError(e, 'No se pudo guardar el comentario')
    } finally {
      setEnviando(false)
    }
  }

  const toggleCat = (c: string) => setCats(s => (s.includes(c) ? s.filter(x => x !== c) : [...s, c]))

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-2 sm:p-6 text-left text-gray-900 normal-case font-normal" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><ClockIcon className="h-5 w-5 text-indigo-600" /> Seguimiento</h2>
            <p className="text-xs text-gray-500">
              {data?.contrato ? `Contrato ${data.contrato} · ` : ''}{data ? `${data.eventos.length} movimiento(s)` : 'Cargando…'}
              {data && visibles.length !== data.eventos.length ? ` · ${visibles.length} con los filtros` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={cargar} disabled={loading} title="Actualizar" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40">
              <ArrowPathIcon className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} title="Cerrar (Esc)" className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
          </div>
        </div>

        {data && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/60 px-5 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CATEGORIAS).filter(([k]) => conteo[k]).map(([k, c]) => (
                <button key={k} type="button" onClick={() => toggleCat(k)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition ${cats.includes(k) ? `${c.chip} ring-current` : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-100'}`}>
                  {c.l} <span className="opacity-60">{conteo[k]}</span>
                </button>
              ))}
              {(Object.keys(ETIQUETAS) as Etiqueta[]).filter(k => conteo[k]).map(k => (
                <button key={k} type="button" onClick={() => setTags(s => (s.includes(k) ? s.filter(x => x !== k) : [...s, k]))}
                  title={`Comentarios de ${ETIQUETAS[k].quien}`}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition ${tags.includes(k) ? `${ETIQUETAS[k].chip} ring-current` : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'}`}>
                  ★ {ETIQUETAS[k].l} <span className="opacity-70">{conteo[k]}</span>
                </button>
              ))}
              {(cats.length > 0 || tags.length > 0) && <button type="button" onClick={() => { setCats([]); setTags([]) }} className="px-1 text-xs text-gray-500 hover:underline">Quitar</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={persona} onChange={e => setPersona(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs">
                <option value="">Todas las personas</option>
                {data.personas.map(p => <option key={p._id} value={p._id}>{p.nombre} · {p.tipoUsuario === 'TITULAR' ? 'Titular' : 'Beneficiario'}</option>)}
              </select>
              <div className="relative flex-1 min-w-[180px]">
                <MagnifyingGlassIcon className="absolute left-2 top-1.5 h-4 w-4 text-gray-400" />
                <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar en el seguimiento…"
                  className="w-full rounded-md border border-gray-300 py-1 pl-7 pr-2 text-xs" />
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {data && puedeComentar && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} maxLength={2000}
                placeholder="Escribe un comentario de seguimiento…"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={sobre} onChange={e => setSobre(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs">
                    <option value="">Sobre el contrato (titular)</option>
                    {data.personas.filter(p => p.tipoUsuario !== 'TITULAR').map(p => <option key={p._id} value={p._id}>Sobre {p.nombre} · beneficiario</option>)}
                  </select>
                  {permitidas.length > 0 && (
                    <select value={etiqueta} onChange={e => setEtiqueta(e.target.value as Etiqueta | '')} title="Etiqueta resaltada del comentario"
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${etiqueta ? `${ETIQUETAS[etiqueta].chip} border-transparent` : 'border-gray-300 bg-white text-gray-700'}`}>
                      <option value="">Sin etiqueta</option>
                      {permitidas.map(k => <option key={k} value={k}>★ {ETIQUETAS[k].l}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">Queda con tu nombre, fecha y hora; no se puede editar.</span>
                  <button type="button" onClick={comentar} disabled={enviando || comentario.trim().length < 3}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                    {enviando ? 'Guardando…' : 'Comentar'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {loading && !data ? (
            <p className="py-10 text-center text-sm italic text-gray-400">Cargando seguimiento…</p>
          ) : !visibles.length ? (
            <p className="py-10 text-center text-sm text-gray-500">Sin movimientos{data?.eventos.length ? ' con estos filtros' : ''}.</p>
          ) : (
            <ol className="relative ml-1.5 border-l border-gray-200">
              {visibles.map(e => {
                const c = CATEGORIAS[e.categoria] || CATEGORIAS.COMENTARIO
                const cambios = e.cambios ? Object.entries(e.cambios) : []
                const tg = e.etiqueta ? ETIQUETAS[e.etiqueta] : null
                return (
                  <li key={e.id} className={`mb-4 ml-5 ${tg ? `rounded-lg px-3 py-2 ${tg.fila}` : ''}`}>
                    <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${c.dot}`} />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${c.chip}`}>{c.l}</span>
                      {tg && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tg.badge}`} title={`Comentario de ${tg.quien}`}>★ {tg.l}</span>}
                      <span className="font-medium text-gray-900">{e.accion}</span>
                      <span className="text-xs text-gray-400">{fmtFecha(e)}</span>
                      {e.usuario && <span className="text-xs text-gray-500" title={e.usuarioEmail || undefined}>· {e.usuario}</span>}
                      {e.personaNombre && (
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${e.tipoUsuario === 'TITULAR' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                          {e.personaNombre}{e.tipoUsuario === 'TITULAR' ? ' · titular' : ''}
                        </span>
                      )}
                    </div>
                    {e.detalle && <p className="mt-0.5 whitespace-pre-line text-sm text-gray-600">{e.detalle}</p>}
                    {cambios.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-indigo-700 hover:underline">Ver cambios ({cambios.length})</summary>
                        <table className="mt-1 w-full max-w-2xl text-left">
                          <tbody>
                            {cambios.map(([k, v]) => (
                              <tr key={k} className="border-b border-gray-100 align-top">
                                <td className="py-0.5 pr-3 font-medium text-gray-700">{k}</td>
                                <td className="py-0.5 pr-2 text-red-700 line-through break-all">{valor(v.antes)}</td>
                                <td className="py-0.5 text-green-700 break-all">{valor(v.despues)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
        <p className="border-t border-gray-100 px-5 py-2 text-[11px] text-gray-400">
          Documentos borrados, ediciones del contrato, envío del PDF, gestor de recaudo, apoderado y cambios de step sin auditoría
          se registran desde el 10/11/2026; lo anterior sale de los historiales que ya existían.
        </p>
      </div>
    </div>
  )
}
