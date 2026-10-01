'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  XMarkIcon, DocumentTextIcon, ArrowUpTrayIcon, TrashIcon, EyeIcon,
  ReceiptPercentIcon, ArrowPathIcon, MusicalNoteIcon, CheckCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { usePermissions } from '@/hooks/usePermissions'
import { PersonPermission } from '@/types/permissions'
import { ACCEPT_DOCUMENTOS, esAudio, esImagen } from '@/lib/documentos-adjuntos'
import {
  ACCEPT_RECIBO, MAX_MB_RECIBO, reciboPermitido, resumenRecibo,
  type ReciboInscripcion, type ReciboExtraido,
} from '@/lib/recibo-inscripcion'

/**
 * "Documentación y recibo" — el mismo modal en el detalle del contrato, la ficha
 * /person y Gestión Contrato (y, en modo revisión, en Recaudos).
 *
 *   Documentación → PEOPLE.documentacion (varios archivos: imágenes, PDF, audios)
 *   Recibo        → PEOPLE.reciboInscripcion del titular (uno; se lee con IA)
 *
 * `personId` puede ser el titular o un beneficiario: el recibo siempre se
 * resuelve en el titular del contrato (lo hace el servidor).
 * `revision` muestra el formulario con el que Recaudos corrige lo leído.
 */
interface Props {
  open: boolean
  personId: string | null
  subtitulo?: string
  onClose: () => void
  /** Avisa cambios (para refrescar contadores o listas del que lo abre). */
  onChange?: (info: { documentos: number; tieneRecibo: boolean }) => void
  revision?: boolean
}

interface DatosRecibo {
  recibo: ReciboInscripcion | null
  historial: ReciboInscripcion[]
  inscripcion: number | null
  coincide: boolean
  puedeSubir: boolean
  puedeLeer: boolean
}

const pesos = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('es-CL')}`

function Miniatura({ url, tipo, nombre, grande }: { url: string; tipo?: string | null; nombre?: string | null; grande?: boolean }) {
  const cls = grande ? 'h-16 w-16' : 'h-12 w-12'
  if (esImagen(tipo, nombre || url)) {
    return <img src={url} alt={nombre || 'archivo'} className={`${cls} rounded object-cover border border-gray-200 hover:ring-2 hover:ring-indigo-300`} />
  }
  if (esAudio(tipo, nombre)) {
    return <span className={`${cls} rounded bg-sky-50 border border-sky-100 flex items-center justify-center`}><MusicalNoteIcon className="w-6 h-6 text-sky-500" /></span>
  }
  return <span className={`${cls} rounded bg-red-50 border border-red-100 flex items-center justify-center`}><DocumentTextIcon className="w-6 h-6 text-red-400" /></span>
}

export default function DocumentosReciboModal({ open, personId, subtitulo, onClose, onChange, revision }: Props) {
  const { hasPermission } = usePermissions()
  const puedeSubirDoc = hasPermission(PersonPermission.ADICION_DOCUMENTACION)
  const puedeEliminarDoc = hasPermission(PersonPermission.ELIMINAR_DOCUMENTACION)

  const [docs, setDocs] = useState<any[]>([])
  const [datos, setDatos] = useState<DatosRecibo | null>(null)
  const [loading, setLoading] = useState(false)
  const [subiendoDoc, setSubiendoDoc] = useState(false)
  const [subiendoRecibo, setSubiendoRecibo] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [guardandoRev, setGuardandoRev] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [form, setForm] = useState<Partial<Record<keyof ReciboExtraido, string>>>({})

  const avisar = (d: any[], r: DatosRecibo | null) =>
    onChange?.({ documentos: d.length, tieneRecibo: !!r?.recibo })

  const llenarForm = (e: ReciboExtraido | null | undefined) =>
    setForm({
      medioPago: e?.medioPago || '',
      fecha: e?.fecha || '',
      monto: e?.monto !== null && e?.monto !== undefined ? String(e.monto) : '',
      referencia: e?.referencia || '',
      banco: e?.banco || '',
    })

  const aplicarRecibo = (r: any) => {
    setDatos(prev => {
      const nuevo: DatosRecibo = {
        recibo: r.recibo ?? prev?.recibo ?? null,
        historial: r.historial ?? prev?.historial ?? [],
        inscripcion: r.inscripcion ?? prev?.inscripcion ?? null,
        coincide: !!r.coincide,
        puedeSubir: r.puedeSubir ?? prev?.puedeSubir ?? false,
        puedeLeer: r.puedeLeer ?? prev?.puedeLeer ?? false,
      }
      llenarForm(nuevo.recibo?.extraido)
      return nuevo
    })
  }

  useEffect(() => {
    if (!open || !personId) return
    setDocs([]); setDatos(null); setVerHistorial(false); setLoading(true)
    Promise.all([
      fetch(`/api/contracts/${personId}/documents`, { cache: 'no-store' }).then(x => x.json()).catch(() => null),
      fetch(`/api/contracts/${personId}/recibo-inscripcion`, { cache: 'no-store' }).then(x => x.json()).catch(() => null),
    ]).then(([d, r]) => {
      if (d?.success) setDocs(d.documentacion || [])
      if (r?.success) aplicarRecibo(r)
    }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId])

  if (!open || !personId) return null

  const subirArchivo = async (file: File, proposito?: 'recibo') => {
    const fd = new FormData()
    fd.append('file', file)
    if (proposito) fd.append('proposito', proposito)
    const up = await fetch(`/api/contracts/${personId}/upload-url`, { method: 'POST', body: fd })
    const j = await up.json().catch(() => ({}))
    if (!up.ok || !j.success) throw new Error(j.error || `Error ${up.status}`)
    return j.publicUrl as string
  }

  const subirDocs = async (files: File[]) => {
    if (!files.length) return
    setSubiendoDoc(true)
    let lista = docs
    try {
      for (const file of files) {
        const url = await subirArchivo(file)
        const saved = await fetch(`/api/contracts/${personId}/documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, nombre: file.name, tipo: file.type }),
        }).then(x => x.json())
        if (!saved?.success) throw new Error(saved?.error || 'No se pudo registrar el documento')
        lista = saved.documentacion || []
        setDocs(lista)
      }
      toast.success(files.length === 1 ? 'Documento subido' : `${files.length} documentos subidos`)
    } catch (e: any) {
      toast.error(e?.message || 'Error subiendo documentación')
    } finally {
      setSubiendoDoc(false)
      avisar(lista, datos)
    }
  }

  const eliminarDoc = async (url: string, nombre: string) => {
    if (!confirm(`¿Eliminar "${nombre}"? También se borra el archivo.`)) return
    const d = await fetch(`/api/contracts/${personId}/documents`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    }).then(x => x.json()).catch(() => null)
    if (d?.success) { setDocs(d.documentacion || []); avisar(d.documentacion || [], datos); toast.success('Documento eliminado') }
    else toast.error(d?.error || 'No se pudo eliminar')
  }

  const subirRecibo = async (file: File) => {
    if (!reciboPermitido(file.type, file.name)) { toast.error('El recibo debe ser una imagen JPG, PNG o WEBP, o un PDF.'); return }
    if (file.size > MAX_MB_RECIBO * 1024 * 1024) { toast.error(`El recibo supera ${MAX_MB_RECIBO} MB.`); return }
    if (datos?.recibo && !confirm('Ya hay un recibo. ¿Reemplazarlo? El anterior queda en el historial.')) return
    setSubiendoRecibo(true)
    try {
      const url = await subirArchivo(file, 'recibo')
      const r = await fetch(`/api/contracts/${personId}/recibo-inscripcion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, nombre: file.name, tipo: file.type }),
      }).then(x => x.json())
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar el recibo')
      // El historial cambió en el servidor: se vuelve a pedir completo.
      const fresco = await fetch(`/api/contracts/${personId}/recibo-inscripcion`, { cache: 'no-store' }).then(x => x.json()).catch(() => null)
      aplicarRecibo(fresco?.success ? fresco : r)
      if (r.recibo?.lectura === 'OK') toast.success('Recibo guardado y leído')
      else toast.error(r.message || 'Recibo guardado, pero no se pudo leer')
      avisar(docs, { ...(datos as DatosRecibo), recibo: r.recibo })
    } catch (e: any) {
      toast.error(e?.message || 'Error subiendo el recibo')
    } finally {
      setSubiendoRecibo(false)
    }
  }

  const releer = async () => {
    setLeyendo(true)
    try {
      const r = await fetch(`/api/contracts/${personId}/recibo-inscripcion/leer`, { method: 'POST' }).then(x => x.json())
      if (!r?.success) throw new Error(r?.error || 'No se pudo leer')
      aplicarRecibo(r)
      if (r.recibo?.lectura === 'OK') toast.success('Recibo leído')
      else toast.error(r.recibo?.lecturaError || 'No se pudo leer el recibo')
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo leer')
    } finally {
      setLeyendo(false)
    }
  }

  const guardarRevision = async () => {
    setGuardandoRev(true)
    try {
      const r = await fetch(`/api/contracts/${personId}/recibo-inscripcion/revision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, monto: form.monto ? Number(String(form.monto).replace(/[^\d.]/g, '')) : null }),
      }).then(x => x.json())
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar')
      aplicarRecibo(r)
      toast.success(r.cuotaPrecargada ? 'Guardado. La cuota de inscripción quedó precargada (sin validar).' : 'Guardado.')
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally {
      setGuardandoRev(false)
    }
  }

  const elegir = (multiple: boolean, accept: string, cb: (files: File[]) => void) => {
    const i = document.createElement('input')
    i.type = 'file'; i.multiple = multiple; i.accept = accept
    i.onchange = () => cb(Array.from(i.files || []))
    i.click()
  }

  const recibo = datos?.recibo || null
  const ext = recibo?.extraido || null
  const hayMonto = ext?.monto !== null && ext?.monto !== undefined
  const puedeRevisar = !!revision && !!datos?.puedeLeer && !!recibo

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start p-5 border-b border-indigo-100 bg-indigo-50 rounded-t-xl">
          <div>
            <h3 className="text-lg font-bold text-indigo-800 flex items-center gap-2"><DocumentTextIcon className="w-5 h-5" /> Documentación y recibo</h3>
            {subtitulo && <p className="text-xs text-gray-600 mt-0.5">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-500 hover:text-gray-700"><XMarkIcon className="w-6 h-6" /></button>
        </div>

        <div className="p-5 space-y-6">
          {loading ? (
            <div className="text-center text-gray-500 py-8">Cargando…</div>
          ) : (
            <>
              {/* ── Documentación ───────────────────────────────────── */}
              <section>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    <DocumentTextIcon className="w-4 h-4 text-indigo-600" /> Documentación
                    <span className="text-xs font-normal text-gray-500">({docs.length})</span>
                  </h4>
                  {puedeSubirDoc && (
                    <button type="button" onClick={() => elegir(true, ACCEPT_DOCUMENTOS, subirDocs)} disabled={subiendoDoc}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                      <ArrowUpTrayIcon className="w-4 h-4" /> {subiendoDoc ? 'Subiendo…' : 'Subir documentos'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-2">Documentos del contrato (imágenes, PDF o audios). El recibo de pago va en la sección de abajo.</p>
                {docs.length === 0 ? (
                  <div className="text-sm text-gray-400 italic border border-dashed border-gray-200 rounded-lg p-4 text-center">Sin documentos aún.</div>
                ) : (
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    {docs.map((d: any, i: number) => {
                      const url = typeof d === 'string' ? d : d?.url
                      const nombre = typeof d === 'string' ? 'Documento' : (d?.nombre || 'Documento')
                      const tipo = typeof d === 'string' ? null : d?.tipo
                      return (
                        <li key={`${url}-${i}`} className="flex items-center gap-3 px-3 py-2">
                          <a href={url} target="_blank" rel="noopener noreferrer" title="Ver" className="shrink-0">
                            <Miniatura url={url} tipo={tipo} nombre={nombre} />
                          </a>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-900 truncate" title={nombre}>{nombre}</p>
                            {esAudio(tipo, nombre) ? (
                              <audio controls preload="none" src={url} className="h-8 mt-1 max-w-full" />
                            ) : (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
                                <EyeIcon className="w-3.5 h-3.5" /> Ver {esImagen(tipo, nombre) ? 'imagen' : 'documento'}
                              </a>
                            )}
                            {d?.fechaSubida && <span className="text-[11px] text-gray-400 ml-2">{new Date(d.fechaSubida).toLocaleDateString('es-CL')}</span>}
                          </div>
                          {puedeEliminarDoc && typeof d !== 'string' && (
                            <button type="button" onClick={() => eliminarDoc(url, nombre)} title="Eliminar" className="text-red-400 hover:text-red-600 shrink-0">
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* ── Recibo de inscripción ───────────────────────────── */}
              <section>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    <ReceiptPercentIcon className="w-4 h-4 text-emerald-600" /> Recibo de inscripción
                  </h4>
                  {datos?.puedeSubir && (
                    <button type="button" disabled={subiendoRecibo}
                      onClick={() => elegir(false, ACCEPT_RECIBO, fs => { if (fs[0]) subirRecibo(fs[0]) })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      <ArrowUpTrayIcon className="w-4 h-4" />
                      {subiendoRecibo ? 'Subiendo y leyendo…' : (recibo ? 'Reemplazar recibo' : 'Subir recibo')}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Un solo archivo (JPG, PNG, WEBP o PDF, máx. {MAX_MB_RECIBO} MB). Al subirlo se lee automáticamente.
                </p>

                {!recibo ? (
                  <div className="text-sm text-gray-400 italic border border-dashed border-gray-200 rounded-lg p-4 text-center">
                    Sin recibo aún.{!datos?.puedeSubir && <span className="block not-italic text-xs text-gray-500 mt-1">Para subirlo se necesita el permiso «Subir recibo».</span>}
                  </div>
                ) : (
                  <div className="border border-emerald-100 bg-emerald-50/60 rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <a href={recibo.url} target="_blank" rel="noopener noreferrer" title="Ver recibo" className="shrink-0">
                        <Miniatura url={recibo.url} tipo={recibo.tipo} nombre={recibo.nombre} grande />
                      </a>
                      <div className="min-w-0 flex-1 text-sm">
                        <a href={recibo.url} target="_blank" rel="noopener noreferrer" className="text-emerald-800 font-medium hover:underline break-all">{recibo.nombre || 'Recibo'}</a>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Subido {new Date(recibo.subidoEn).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}
                          {recibo.subidoPor ? ` por ${recibo.subidoPor}` : ''}
                        </p>
                        {recibo.lectura === 'OK' && ext && (
                          <p className="text-xs text-gray-800 mt-1 font-medium">{resumenRecibo(ext) || 'La lectura no encontró datos.'}{ext.banco ? ` · ${ext.banco}` : ''}</p>
                        )}
                        {recibo.revisadoPor && (
                          <p className="text-[11px] text-emerald-700 mt-0.5">Revisado por {recibo.revisadoPor}</p>
                        )}
                      </div>
                      {(datos?.puedeSubir || datos?.puedeLeer) && (
                        <button type="button" onClick={releer} disabled={leyendo} title="Volver a leer con IA"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-emerald-700 border border-emerald-200 bg-white hover:bg-emerald-50 disabled:opacity-50">
                          <ArrowPathIcon className={`w-3.5 h-3.5 ${leyendo ? 'animate-spin' : ''}`} /> {leyendo ? 'Leyendo…' : 'Leer'}
                        </button>
                      )}
                    </div>

                    {recibo.lectura === 'FALLIDA' && (
                      <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
                        <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-px" />
                        <span>El recibo quedó guardado, pero no se pudo leer: {recibo.lecturaError}. Pulsa «Leer» para intentarlo de nuevo.</span>
                      </div>
                    )}
                    {recibo.lectura === 'PENDIENTE' && (
                      <p className="text-xs text-gray-500">Pendiente de lectura.</p>
                    )}
                    {recibo.lectura === 'OK' && ext && (
                      datos?.inscripcion && hayMonto ? (
                        datos.coincide ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-100/70 rounded-md px-2.5 py-1.5">
                            <CheckCircleIcon className="w-4 h-4" /> El monto coincide con la inscripción del contrato ({pesos(datos.inscripcion)}).
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-px" />
                            <span>El recibo dice <b>{pesos(ext.monto)}</b> y la inscripción del contrato es <b>{pesos(datos.inscripcion)}</b>. Revísalo antes de verificar el pago.</span>
                          </div>
                        )
                      ) : (
                        <p className="text-xs text-amber-700">No se pudo leer el monto: compáralo a mano con la inscripción ({pesos(datos?.inscripcion)}).</p>
                      )
                    )}

                    {puedeRevisar && (
                      <div className="border-t border-emerald-100 pt-3 mt-1">
                        <p className="text-xs font-semibold text-gray-700 mb-2">Revisar lo leído</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {([
                            ['medioPago', 'Medio de pago', 'text'],
                            ['fecha', 'Fecha', 'date'],
                            ['monto', 'Monto', 'text'],
                            ['referencia', 'Referencia', 'text'],
                            ['banco', 'Banco', 'text'],
                          ] as const).map(([k, label, type]) => (
                            <label key={k} className="text-[11px] text-gray-600">
                              {label}
                              <input type={type} value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:ring-emerald-500 focus:border-emerald-500" />
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-3 mt-2">
                          <p className="text-[11px] text-gray-500">Al guardar se precarga la cuota de inscripción (fecha, referencia y medio). No la valida.</p>
                          <button type="button" onClick={guardarRevision} disabled={guardandoRev}
                            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                            {guardandoRev ? 'Guardando…' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(datos?.historial?.length || 0) > 0 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => setVerHistorial(v => !v)} className="text-xs text-gray-600 hover:text-gray-900 underline">
                      {verHistorial ? 'Ocultar' : 'Ver'} recibos anteriores ({datos!.historial.length})
                    </button>
                    {verHistorial && (
                      <ul className="mt-2 space-y-1">
                        {[...datos!.historial].reverse().map((h, i) => (
                          <li key={`${h.url}-${i}`} className="text-xs text-gray-600 flex flex-wrap gap-x-2">
                            <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{h.nombre || 'Recibo'}</a>
                            <span>{resumenRecibo(h.extraido)}</span>
                            {h.reemplazadoEn && <span className="text-gray-400">reemplazado {new Date(h.reemplazadoEn).toLocaleDateString('es-CL')}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
        </div>
      </div>
    </div>
  )
}
