'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { SparklesIcon, PaperAirplaneIcon, BoltIcon } from '@heroicons/react/24/outline'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'

/**
 * Botón "Actividad IA" de /sesion/[id] (extremo derecho de la línea de pestañas).
 *
 * Reemplaza a la caja "Actividad Propuesta (IA)" que vivía POR ESTUDIANTE: aquí
 * se redacta UNA sola actividad para todo el grupo —a mano o generada con IA a
 * partir del temario de la lección— y se envía por WhatsApp a los APODERADOS de
 * los inscritos.
 *
 * Los teléfonos se resuelven en el servidor; el navegador sólo manda el texto y,
 * si el guía acotó la lista, a quiénes. Gateado por ACADEMICO.SESION.ACTIVIDAD_IA.
 */
interface Destinatario {
  academicaId: string
  alumno: string
  apoderado: string
  telefono: string
  origen: 'ficha' | 'titular' | 'alumno' | 'ninguno'
  enviable: boolean
}

export default function SessionActividadIA({ eventoId }: { eventoId: string }) {
  const { hasPermission, isLoading: permsLoading } = usePermissions()
  const puede = permsLoading || hasPermission(AcademicoPermission.SESION_ACTIVIDAD_IA as any)

  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [generando, setGenerando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [data, setData] = useState<{ evento: any; destinatarios: Destinatario[]; total: number; enviables: number } | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<any>(null)

  const cargarDestinatarios = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch(`/api/postgres/calendario/${eventoId}/actividad-ia`, { cache: 'no-store' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setData(r)
      setSeleccion(new Set((r.destinatarios || []).filter((d: Destinatario) => d.enviable).map((d: Destinatario) => d.academicaId)))
    } catch (e: any) {
      toast.error(e?.message || 'No se pudieron cargar los destinatarios')
    } finally { setCargando(false) }
  }, [eventoId])

  useEffect(() => { if (abierto && !data) cargarDestinatarios() }, [abierto, data, cargarDestinatarios])

  const generar = async () => {
    setGenerando(true)
    try {
      const r = await fetch(`/api/postgres/calendario/${eventoId}/actividad-ia`, { method: 'POST' }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setTexto(r.actividad || '')
      toast.success('Actividad generada — revísala antes de enviarla')
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo generar la actividad')
    } finally { setGenerando(false) }
  }

  const enviar = async () => {
    setEnviando(true)
    try {
      const r = await fetch(`/api/postgres/calendario/${eventoId}/actividad-ia/enviar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto, academicaIds: Array.from(seleccion) }),
      }).then(x => x.json())
      if (r.error) throw new Error(r.error)
      setResultado(r)
      setConfirmar(false)
      if (r.fallidos > 0) toast.error(`${r.enviados} enviados, ${r.fallidos} con error`)
      else toast.success(`Actividad enviada a ${r.enviados} apoderado(s)`)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar la actividad')
      setConfirmar(false)
    } finally { setEnviando(false) }
  }

  const cerrar = () => { setAbierto(false); setConfirmar(false); setResultado(null) }

  if (!puede) return null

  const destinatarios = data?.destinatarios || []
  const sinTelefono = destinatarios.filter(d => !d.enviable)
  const nSeleccion = seleccion.size

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Redactar la actividad del grupo y enviarla a los apoderados"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 my-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 shrink-0"
      >
        <SparklesIcon className="h-4 w-4" /> Actividad IA
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={cerrar}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <SparklesIcon className="h-5 w-5 text-purple-600" /> Actividad de la sesión
                </h3>
                <p className="text-xs text-gray-500">
                  {data?.evento
                    ? `${data.evento.curso}${data.evento.modulo ? ` · ${data.evento.modulo}` : ''}${data.evento.leccion ? ` · ${data.evento.leccion}` : ''}`
                    : 'Cargando…'}
                </p>
              </div>
              <button type="button" onClick={cerrar} title="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>

            {/* --- Resultado del envío --- */}
            {resultado ? (
              <div className="p-5">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-4">
                  <p className="font-bold text-emerald-800">Enviados: {resultado.enviados}</p>
                  {resultado.fallidos > 0 && <p className="text-sm text-red-700 mt-0.5">Con error: {resultado.fallidos}</p>}
                  {resultado.sinTelefono > 0 && <p className="text-sm text-amber-700 mt-0.5">Sin teléfono de apoderado: {resultado.sinTelefono}</p>}
                </div>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {(resultado.resultados || []).map((r: any, i: number) => (
                    <li key={i} className={`text-[13px] flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 border ${r.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                      <span className="truncate">{r.ok ? '✓' : '✗'} {r.alumno}</span>
                      <span className="text-gray-500 shrink-0">{r.ok ? r.telefono : (r.error || 'error')}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex justify-end">
                  <button type="button" onClick={cerrar} className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium hover:bg-gray-900">Cerrar</button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                {/* Texto de la actividad */}
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="actividad-ia-texto" className="text-[11px] uppercase tracking-wide text-gray-500 font-bold">
                    Actividad para todo el grupo
                  </label>
                  <button
                    type="button" onClick={generar} disabled={generando}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-50"
                  >
                    <BoltIcon className="h-4 w-4" /> {generando ? 'Generando…' : (texto ? 'Regenerar con IA' : 'Generar con IA')}
                  </button>
                </div>
                <textarea
                  id="actividad-ia-texto"
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  rows={7}
                  maxLength={1200}
                  placeholder="Escribe la actividad, o genérala con IA a partir del temario de la lección. Puedes editar el texto antes de enviarlo."
                  className="w-full px-3.5 py-3 border border-gray-300 rounded-xl text-sm resize-y focus:border-purple-400 focus:ring-1 focus:ring-purple-300 outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">{texto.length}/1200 · se envía tal cual por WhatsApp, con el nombre del estudiante al inicio.</p>

                {/* Destinatarios */}
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500 font-bold">
                      Apoderados ({nSeleccion} de {data?.enviables ?? 0})
                    </span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setSeleccion(new Set(destinatarios.filter(d => d.enviable).map(d => d.academicaId)))}
                        className="text-[11px] text-purple-700 hover:underline">Todos</button>
                      <button type="button" onClick={() => setSeleccion(new Set())}
                        className="text-[11px] text-gray-500 hover:underline">Ninguno</button>
                    </div>
                  </div>

                  {cargando ? (
                    <p className="text-sm text-gray-400 py-6 text-center">Cargando inscritos…</p>
                  ) : destinatarios.length === 0 ? (
                    <p className="text-sm text-gray-400 py-6 text-center">Este evento no tiene inscritos.</p>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
                      {destinatarios.map(d => (
                        <li key={d.academicaId} className={`flex items-center gap-3 px-3 py-2 ${d.enviable ? '' : 'bg-gray-50'}`}>
                          <input
                            type="checkbox" className="accent-purple-600"
                            disabled={!d.enviable}
                            checked={seleccion.has(d.academicaId)}
                            onChange={e => setSeleccion(prev => {
                              const n = new Set(prev)
                              if (e.target.checked) n.add(d.academicaId); else n.delete(d.academicaId)
                              return n
                            })}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-gray-800 truncate">{d.alumno}</p>
                            <p className="text-[11px] text-gray-500 truncate">
                              {d.enviable ? `${d.apoderado || 'Apoderado'} · ${d.telefono}` : 'Sin teléfono de apoderado'}
                              {d.origen === 'titular' && <span className="text-amber-600"> · titular</span>}
                              {d.origen === 'alumno' && <span className="text-amber-600"> · teléfono del alumno</span>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sinTelefono.length > 0 && (
                    <p className="text-[11.5px] text-amber-700 mt-2">
                      {sinTelefono.length} inscrito(s) sin teléfono de apoderado — no recibirán el mensaje.
                    </p>
                  )}
                </div>

                <div className="mt-5 flex justify-end gap-3">
                  <button type="button" onClick={cerrar} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                  <button
                    type="button" onClick={() => setConfirmar(true)}
                    disabled={!texto.trim() || nSeleccion === 0}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" /> Enviar por WhatsApp ({nSeleccion})
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Confirmación — el envío es real y masivo, así que no va con un solo clic. */}
          {confirmar && (
            <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <h4 className="font-bold text-gray-900 mb-1">Enviar la actividad por WhatsApp</h4>
                <p className="text-sm text-gray-600">
                  Se enviará a <strong>{nSeleccion} apoderado(s)</strong>. Los mensajes salen de la línea de MOSAICO y no se pueden deshacer.
                </p>
                <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 p-3 max-h-40 overflow-y-auto">
                  <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{texto}</p>
                </div>
                <div className="mt-5 flex justify-end gap-3">
                  <button type="button" onClick={() => setConfirmar(false)} disabled={enviando}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Cancelar</button>
                  <button type="button" onClick={enviar} disabled={enviando}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {enviando ? 'Enviando…' : `Confirmar envío (${nSeleccion})`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
