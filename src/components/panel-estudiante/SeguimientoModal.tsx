'use client'

import { useMemo, useState } from 'react'
import { useQuery } from 'react-query'
import {
  CheckCircleIcon, XCircleIcon, LockClosedIcon, ClipboardDocumentCheckIcon, PrinterIcon,
} from '@heroicons/react/24/outline'
import MathText from '@/components/ecuaciones/MathText'

/**
 * Modal del botón "Seguimiento" de las cajas Entrenamientos / Evaluaciones del
 * panel del alumno.
 *
 * Lista TODOS los cuestionarios del curso de esa categoría:
 *   · presentados → DESBLOQUEADOS: se abren y muestran el último intento
 *     (porcentaje, acertadas y erradas) pregunta por pregunta, imprimible;
 *   · alcanzados sin presentar (o con intentos libres) → botón "Presentar";
 *   · posteriores a su lección actual → bloqueados.
 *
 * La impresión usa `window.print()` con una hoja `@media print` que oculta todo
 * salvo el detalle — sin dependencias ni endpoint de PDF.
 */
export interface SeguimientoItem {
  code: string; step: string; orden: number | null
  cuestionarioId: string; titulo: string; minutos: number
  intentos: number; intentosMax: number; mejor: number
  aprobado: boolean; agotado: boolean
  presentado: boolean; alcanzada: boolean; bloqueado: boolean; puedePresentar: boolean
  preguntas: Array<{ id: any; type: string; question: string; options: string[] }>
  ultimo: null | {
    intento: number; correctas: number; incorrectas: number; total: number
    porcentaje: number; aprobado: boolean; enviadaEn: string | null; duracionSeg: number | null
    respuestas: Array<{ qId: any; question: string; selected: any; correct: any; ok: boolean }>
  }
  historial: Array<{ intento: number; score: number; total: number; porcentaje: number; aprobado: boolean; enviadaEn: string | null }>
}

const fmtFecha = (iso: string | null) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function SeguimientoModal({
  tipo, titulo, accentBtn, onClose, onPresentar,
}: {
  tipo: 'evaluacion' | 'entrenamiento'
  titulo: string
  /** Clases del botón principal (tono de la caja). */
  accentBtn: string
  onClose: () => void
  /** Lanza el cuestionario pendiente en el flujo normal de presentación. */
  onPresentar: (it: SeguimientoItem) => void
}) {
  const [abierto, setAbierto] = useState<SeguimientoItem | null>(null)

  const { data, isLoading } = useQuery(
    ['seguimiento', tipo],
    () => fetch(`/api/postgres/panel-estudiante/evaluacion/seguimiento?tipo=${tipo}`, { cache: 'no-store' })
      .then(r => r.json()).catch(() => ({ available: false, items: [] })),
    { staleTime: 30_000, refetchOnWindowFocus: false }
  )

  const items: SeguimientoItem[] = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data])
  const presentados = items.filter(i => i.presentado).length
  const aprobados = items.filter(i => i.aprobado).length
  const estudiante = data?.estudiante?.nombre || ''

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto print:static print:bg-transparent print:p-0 print:overflow-visible"
      onClick={onClose}>
      {/* Hoja de impresión: sólo el detalle del intento. */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .seg-print, .seg-print * { visibility: visible !important; }
          .seg-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12px; }
          .seg-no-print { display: none !important; }
        }
      `}</style>

      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full my-6 print:shadow-none print:my-0 print:max-w-full"
        onClick={e => e.stopPropagation()}>

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-100 seg-no-print">
          <div>
            <h3 className="font-bold text-gray-900">Seguimiento · {titulo}</h3>
            <p className="text-xs text-gray-500">
              {isLoading ? 'Cargando…' : `${presentados} de ${items.length} presentado(s) · ${aprobados} aprobado(s)`}
            </p>
          </div>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {/* --- Lista --- */}
        {!abierto ? (
          <div className="p-5">
            {isLoading ? (
              <p className="text-sm text-gray-400 text-center py-10">Cargando tu historial…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                Tu curso todavía no tiene {tipo === 'entrenamiento' ? 'entrenamientos' : 'evaluaciones'}.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => {
                  const estilo = it.aprobado ? 'border-emerald-200 bg-emerald-50'
                    : it.agotado ? 'border-red-200 bg-red-50'
                    : it.bloqueado ? 'border-gray-200 bg-gray-50'
                    : 'border-gray-200 bg-white'
                  return (
                    <li key={`${it.code}|${it.step}|${it.cuestionarioId}`}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${estilo} ${it.presentado ? 'cursor-pointer hover:shadow-sm' : ''}`}
                      onClick={() => { if (it.presentado) setAbierto(it) }}
                      title={it.presentado ? 'Ver el último intento' : undefined}>

                      {it.aprobado ? <CheckCircleIcon className="h-5 w-5 text-emerald-600 shrink-0" />
                        : it.agotado ? <XCircleIcon className="h-5 w-5 text-red-500 shrink-0" />
                        : it.bloqueado ? <LockClosedIcon className="h-5 w-5 text-gray-300 shrink-0" />
                        : <ClipboardDocumentCheckIcon className="h-5 w-5 text-gray-400 shrink-0" />}

                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${it.bloqueado ? 'text-gray-400' : 'text-gray-800'}`}>
                          {it.code}{it.titulo ? ` · ${it.titulo}` : ''}
                        </p>
                        {it.presentado && it.ultimo ? (
                          <p className="text-[11.5px] tabular-nums text-gray-600">
                            <b className="text-emerald-600">{it.ultimo.correctas}</b> acertadas ·{' '}
                            <b className="text-red-600">{it.ultimo.incorrectas}</b> erradas ·{' '}
                            <b>{it.ultimo.porcentaje}%</b>
                            <span className="text-gray-400"> · intento {it.ultimo.intento}/{it.intentosMax}</span>
                          </p>
                        ) : (
                          <p className="text-[11.5px] text-gray-400">
                            {it.bloqueado ? 'Se habilitará cuando avances a esa lección.' : 'Aún no lo has presentado.'}
                          </p>
                        )}
                      </div>

                      {it.presentado ? (
                        <div className="flex items-center gap-2 shrink-0">
                          {it.puedePresentar && (
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); onPresentar(it) }}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg text-white ${accentBtn}`}>
                              Reintentar ({it.intentos + 1})
                            </button>
                          )}
                          <span className="text-[11px] text-gray-400 underline">Ver</span>
                        </div>
                      ) : it.puedePresentar ? (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); onPresentar(it) }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg text-white shrink-0 ${accentBtn}`}>
                          Presentar
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400 shrink-0">{it.bloqueado ? 'Bloqueado' : 'En espera'}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          /* --- Detalle del último intento (imprimible) --- */
          <div className="p-5 seg-print">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h4 className="font-bold text-gray-900">{abierto.code}{abierto.titulo ? ` · ${abierto.titulo}` : ''}</h4>
                <p className="text-xs text-gray-500">
                  {estudiante ? `${estudiante} · ` : ''}{abierto.step}
                  {abierto.ultimo?.enviadaEn ? ` · ${fmtFecha(abierto.ultimo.enviadaEn)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 seg-no-print">
                <button type="button" onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  <PrinterIcon className="h-4 w-4" /> Imprimir
                </button>
                <button type="button" onClick={() => setAbierto(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                  ← Volver
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Intento</div>
                <div className="text-xl font-extrabold">#{abierto.ultimo?.intento} <small className="text-gray-400 text-xs font-semibold">de {abierto.intentosMax}</small></div>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Acertadas</div>
                <div className="text-xl font-extrabold text-emerald-700">{abierto.ultimo?.correctas}</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wide text-red-700 font-semibold">Erradas</div>
                <div className="text-xl font-extrabold text-red-700">{abierto.ultimo?.incorrectas}</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wide text-purple-700 font-semibold">Resultado</div>
                <div className="text-xl font-extrabold text-purple-700">{abierto.ultimo?.porcentaje}%</div>
                <div className="text-[11px] font-bold mt-0.5">
                  {abierto.ultimo?.aprobado ? <span className="text-emerald-600">Aprobó</span> : <span className="text-red-600">No aprobó</span>}
                </div>
              </div>
            </div>

            <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-bold mb-2">Respuestas del último intento</div>
            <ol className="space-y-2 mb-4">
              {(abierto.ultimo?.respuestas || []).map((q, i) => (
                <li key={i} className={`rounded-lg border p-3 ${q.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`text-xs font-bold mt-0.5 ${q.ok ? 'text-emerald-600' : 'text-red-600'}`}>{q.ok ? '✓' : '✗'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-gray-900">{i + 1}. <MathText>{q.question || '(sin enunciado)'}</MathText></div>
                      <div className="text-[12.5px] text-gray-700 mt-1">
                        Respondiste: <b className={q.ok ? 'text-emerald-700' : 'text-red-700'}>
                          {String(q.selected ?? '') ? <MathText>{String(q.selected)}</MathText> : '— sin responder —'}
                        </b>
                      </div>
                      {!q.ok && q.correct !== undefined && String(q.correct) !== '' && (
                        <div className="text-[12.5px] text-gray-700">Correcta: <b className="text-emerald-700"><MathText>{String(q.correct)}</MathText></b></div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {(abierto.ultimo?.respuestas || []).length === 0 && (
                <li className="text-sm text-gray-400 text-center py-4">Este intento no guardó el detalle de las respuestas.</li>
              )}
            </ol>

            {abierto.historial.length > 1 && (
              <>
                <div className="text-[10.5px] uppercase tracking-wide text-gray-500 font-bold mb-2">Todos tus intentos</div>
                <div className="flex flex-wrap gap-2">
                  {abierto.historial.map((h, i) => (
                    <span key={i} className={`text-xs rounded-lg px-2.5 py-1 border ${h.aprobado ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                      #{h.intento}: {h.score}/{h.total} · {h.porcentaje}%
                    </span>
                  ))}
                </div>
              </>
            )}

            {abierto.puedePresentar && (
              <div className="mt-5 flex justify-end seg-no-print">
                <button type="button" onClick={() => onPresentar(abierto)}
                  className={`px-4 py-2 rounded-lg text-white text-sm font-medium ${accentBtn}`}>
                  Reintentar (intento {abierto.intentos + 1})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
