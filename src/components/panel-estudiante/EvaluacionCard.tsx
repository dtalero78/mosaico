'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'react-query'
import toast from 'react-hot-toast'
import { ClipboardDocumentCheckIcon, ClockIcon, CheckCircleIcon, XCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import MathText from '@/components/ecuaciones/MathText'

interface Pregunta { id: any; type: string; question: string; options: string[] }
interface Cuest {
  id: string; titulo: string; minutos: number; preguntas: Pregunta[]
  intentos: number; aprobado: boolean; mejor: number; agotado: boolean; resuelto: boolean; intentosMax: number
}

const ORD = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava']
const ordinal = (i: number) => ORD[i] || `${i + 1}ª`

/**
 * Card "Entrenamientos y Evaluaciones". Al llegar el alumno a una lección de
 * Evaluación/Entrenamiento presenta sus cuestionarios EN ORDEN: cada cuestionario
 * se presenta pregunta por pregunta, con hasta 3 intentos y aprobación ≥60%.
 */
export default function EvaluacionCard({ tipo, titulo }: { tipo?: 'evaluacion' | 'entrenamiento'; titulo?: string } = {}) {
  const qs = tipo ? `?tipo=${tipo}` : ''
  const { data, refetch } = useQuery(
    ['evaluacion-estado', tipo || 'all'],
    () => fetch(`/api/postgres/panel-estudiante/evaluacion${qs}`, { cache: 'no-store' })
      .then((r) => r.json()).catch(() => ({ available: false })),
    { staleTime: 60_000, refetchOnWindowFocus: false }
  )

  const d: any = data || {}
  const reached = !!d.reached
  const label = d.evalCode || 'evaluación'
  const guia = d.guiaNombre || 'tu guía'
  const aprobPct = Number(d.aprobacionPct) || 60
  const cuestionarios: Cuest[] = Array.isArray(d.cuestionarios) ? d.cuestionarios : []
  const pendientes = cuestionarios.filter((c) => !c.resuelto)
  const siguiente = pendientes[0] || null
  const idxDe = (c: Cuest | null) => (c ? cuestionarios.findIndex((x) => x.id === c.id) : -1)

  const [phase, setPhase] = useState<'idle' | 'confirm' | 'eval' | 'done'>('idle')
  const [activo, setActivo] = useState<Cuest | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [qIdx, setQIdx] = useState(0)
  const [remaining, setRemaining] = useState(30 * 60)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ porcentaje: number; aprobado: boolean; intento: number; intentosRestantes: number; agotado: boolean } | null>(null)
  const iniciadaRef = useRef<string>('')

  const submit = async () => {
    if (submitting || !activo) return
    setSubmitting(true)
    try {
      const respuestas = activo.preguntas.map((q, i) => ({ qId: q.id ?? i, selected: answers[String(q.id ?? i)] ?? null }))
      const res = await fetch('/api/postgres/panel-estudiante/evaluacion/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuestionarioId: activo.id, respuestas, iniciadaEn: iniciadaRef.current }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      setResult({ porcentaje: res.porcentaje, aprobado: res.aprobado, intento: res.intento, intentosRestantes: res.intentosRestantes, agotado: res.agotado })
      setPhase('done')
      refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Error al enviar el cuestionario')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (phase !== 'eval') return
    if (remaining <= 0) { submit(); return }
    const t = setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remaining])

  const presentar = (c: Cuest) => { setActivo(c); setPhase('confirm') }
  const aceptar = () => {
    if (!activo) return
    setAnswers({}); setQIdx(0); setRemaining((activo.minutos > 0 ? activo.minutos : 30) * 60); setResult(null)
    iniciadaRef.current = new Date().toISOString()
    setPhase('eval')
  }
  const cerrarDone = () => { setPhase('idle'); setActivo(null) }

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
  const total = cuestionarios.length
  const hechos = cuestionarios.filter((c) => c.resuelto).length
  const idxActivo = idxDe(activo)

  return (
    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardDocumentCheckIcon className="h-5 w-5 text-orange-600" />
        <h3 className="text-sm font-bold text-orange-800 uppercase tracking-wide">{titulo || 'Entrenamientos y Evaluaciones'}</h3>
      </div>

      {!reached ? (
        d.evalCode ? (
          <>
            <p className="text-sm text-gray-600">Siguiente:</p>
            <p className="text-lg font-bold text-orange-700 mt-0.5">{d.evalCode}</p>
            {Number(d.faltanLecciones) > 0 ? (
              <p className="text-sm text-gray-700 mt-2">Te faltan <strong className="text-orange-700">{d.faltanLecciones}</strong> lección(es) para llegar.</p>
            ) : d.faltanLecciones === 0 ? (
              <p className="text-sm text-emerald-700 font-medium mt-2">¡Estás a un paso! Es tu próxima lección.</p>
            ) : null}
            <p className="text-xs text-gray-500 mt-2">Se habilitará cuando avances a esa lección.</p>
          </>
        ) : (
          <p className="text-sm text-gray-500 mt-1">No tienes {tipo === 'entrenamiento' ? 'un entrenamiento próximo' : 'una evaluación próxima'}.</p>
        )
      ) : !d.tieneEvaluacion ? (
        <p className="text-sm text-gray-500 mt-1">La evaluación de esta lección aún no está disponible.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700">
            Has avanzado a <strong>{label}</strong>. {total > 1
              ? <>Debes presentar los <strong>{total} cuestionarios</strong> en orden.</>
              : <>Sigue las instrucciones de tu guía para realizar la evaluación.</>}
          </p>
          {d.completa && <p className="text-xs text-emerald-700 font-medium mt-1">✓ Completaste la evaluación.</p>}
          {total > 1 && !d.completa && <p className="text-xs text-gray-500 mt-1">Progreso: {hechos}/{total}</p>}

          <ul className="mt-3 space-y-2">
            {cuestionarios.map((c, i) => {
              const esSiguiente = siguiente?.id === c.id
              const estilo = c.aprobado ? 'border-emerald-200 bg-emerald-50'
                : c.agotado ? 'border-red-200 bg-red-50'
                : esSiguiente ? 'border-orange-300 bg-white' : 'border-gray-200 bg-white/60'
              return (
                <li key={c.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${estilo}`}>
                  {c.aprobado ? <CheckCircleIcon className="h-5 w-5 text-emerald-600 shrink-0" />
                    : c.agotado ? <XCircleIcon className="h-5 w-5 text-red-500 shrink-0" />
                    : esSiguiente ? <ClipboardDocumentCheckIcon className="h-5 w-5 text-orange-500 shrink-0" />
                    : <LockClosedIcon className="h-5 w-5 text-gray-300 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.titulo || `Cuestionario ${i + 1}`}</p>
                    <p className="text-[11px] text-gray-500">
                      {c.preguntas.length} preg · {c.minutos} min
                      {c.intentos > 0 ? ` · ${c.intentos}/${c.intentosMax} intentos · mejor ${c.mejor}%` : ''}
                    </p>
                  </div>
                  {c.aprobado ? <span className="text-[11px] text-emerald-700 font-semibold shrink-0">Aprobado</span>
                    : c.agotado ? <span className="text-[11px] text-red-600 font-semibold shrink-0">No aprobado</span>
                    : esSiguiente ? (
                      <button type="button" onClick={() => presentar(c)}
                        className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 shrink-0">
                        {c.intentos > 0 ? `Reintentar (${c.intentos + 1})` : 'Presentar'}</button>
                    ) : <span className="text-[11px] text-gray-400 shrink-0">En espera</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* Modal 1 — confirmación por parte */}
      {phase === 'confirm' && activo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <ClipboardDocumentCheckIcon className="h-10 w-10 text-orange-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900 mb-0.5">
              {total > 1 ? `Vas a presentar la ${ordinal(idxActivo)} parte de la evaluación` : 'Evaluación'}
            </h3>
            <p className="text-sm font-semibold text-orange-700 mb-2">{activo.titulo}</p>
            <p className="text-sm text-gray-600">Sigue las instrucciones de tu guía, <strong>{guia}</strong>.</p>
            <div className="mt-3">
              <span className="inline-block text-[11px] font-semibold bg-orange-50 text-orange-700 rounded-full px-3 py-1">
                {activo.preguntas.length} preguntas · {activo.minutos} min · aprobación {aprobPct}% · {activo.intentosMax} intentos
              </span>
            </div>
            {activo.intentos > 0 && <p className="text-xs text-gray-500 mt-2">Vas por el intento <strong>{activo.intentos + 1}</strong> de {activo.intentosMax}.</p>}
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={() => setPhase('idle')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Salir</button>
              <button type="button" onClick={aceptar}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Aceptar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2 — cuestionario pregunta por pregunta */}
      {phase === 'eval' && activo && activo.preguntas.length > 0 && (() => {
        const q = activo.preguntas[qIdx]
        const key = String(q.id ?? qIdx)
        const opts = q.type === 'true_false' ? ['Verdadero', 'Falso'] : q.options
        const respondida = answers[key] != null
        const ultima = qIdx === activo.preguntas.length - 1
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6">
              <div className="bg-white border-b border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 truncate pr-3">{activo.titulo}</h3>
                <div className={`flex items-center gap-1.5 text-sm font-semibold shrink-0 ${remaining <= 60 ? 'text-red-600' : 'text-gray-700'}`}>
                  <ClockIcon className="h-5 w-5" /> {mmss}
                </div>
              </div>
              <div className="px-5 pt-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Pregunta {qIdx + 1} de {activo.preguntas.length}</span>
                  <span>{Object.keys(answers).length}/{activo.preguntas.length} respondidas</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className="h-full bg-gradient-to-r from-purple-600 to-fuchsia-500" style={{ width: `${((qIdx + 1) / activo.preguntas.length) * 100}%` }} />
                </div>
              </div>
              <div className="px-5 pb-5">
                <div className="text-[15px] font-medium text-gray-800 mb-4"><MathText block>{q.question}</MathText></div>
                <div className="space-y-2.5">
                  {opts.map((opt, oj) => {
                    const sel = answers[key] === opt
                    return (
                      <label key={oj} className={`flex items-center gap-3 border rounded-xl px-3.5 py-3 cursor-pointer text-sm ${sel ? 'border-fuchsia-400 bg-fuchsia-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="radio" name={`q-${key}`} className="accent-fuchsia-600" checked={sel}
                          onChange={() => setAnswers((a) => ({ ...a, [key]: opt }))} />
                        <span className="text-gray-800"><MathText>{opt}</MathText></span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="bg-white border-t border-gray-100 rounded-b-2xl px-5 py-3 flex items-center justify-between">
                <button type="button" onClick={() => setQIdx((i) => Math.max(0, i - 1))} disabled={qIdx === 0}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm disabled:opacity-40">← Atrás</button>
                {ultima ? (
                  <button type="button" onClick={submit} disabled={submitting || !respondida}
                    className="px-5 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-40 text-sm">
                    {submitting ? 'Enviando…' : 'Enviar evaluación'}</button>
                ) : (
                  <button type="button" onClick={() => setQIdx((i) => i + 1)} disabled={!respondida}
                    className="px-5 py-2 rounded-lg bg-purple-700 text-white font-medium hover:bg-purple-800 disabled:opacity-40 text-sm">Siguiente →</button>
                )}
              </div>
              <div className="px-5 pb-3 -mt-1 flex justify-between items-center">
                <button type="button" onClick={() => { if (confirm('¿Salir sin enviar? Se perderán tus respuestas de este intento.')) setPhase('idle') }}
                  className="text-xs text-gray-400 hover:text-gray-600">Salir sin enviar</button>
                {!respondida && <span className="text-[11px] text-amber-600">Responde para continuar</span>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal 3 — resultado del intento */}
      {phase === 'done' && result && activo && (() => {
        const proximo = cuestionarios.find((c) => c.id !== activo.id && !c.resuelto) || null
        const puedeReintentar = !result.aprobado && !result.agotado
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
              <div className={`text-4xl font-extrabold ${result.aprobado ? 'text-emerald-600' : 'text-red-600'}`}>{result.porcentaje}%</div>
              <p className={`font-bold mt-1 ${result.aprobado ? 'text-emerald-700' : 'text-red-700'}`}>
                {result.aprobado ? '¡Aprobado!' : 'No aprobado'} · Intento {result.intento} de {activo.intentosMax}
              </p>
              {puedeReintentar ? (
                <>
                  <p className="text-sm text-gray-600 mt-2">Necesitas <strong>{aprobPct}%</strong>. Te quedan <strong>{result.intentosRestantes}</strong> intento(s).</p>
                  <div className="mt-5 flex justify-center gap-3">
                    <button type="button" onClick={cerrarDone} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Más tarde</button>
                    <button type="button" onClick={aceptar} className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Reintentar (intento {result.intento + 1})</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mt-2">
                    {result.aprobado ? (proximo ? 'Continúa con la siguiente parte.' : 'Completaste la evaluación.')
                      : (proximo ? 'Agotaste los intentos de este cuestionario. Continúa con la siguiente parte.' : 'Agotaste los intentos de este cuestionario.')}
                  </p>
                  <div className="mt-5 flex justify-center gap-3">
                    {proximo ? (
                      <>
                        <button type="button" onClick={cerrarDone} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Más tarde</button>
                        <button type="button" onClick={() => presentar(proximo)} className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Siguiente parte →</button>
                      </>
                    ) : (
                      <button type="button" onClick={cerrarDone} className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Cerrar</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
