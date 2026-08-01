'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'react-query'
import toast from 'react-hot-toast'
import { ClipboardDocumentCheckIcon, ClockIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import MathText from '@/components/ecuaciones/MathText'

interface Pregunta { id: any; type: string; question: string; options: string[] }
interface Cuest { id: string; titulo: string; minutos: number; preguntas: Pregunta[] }

/**
 * Card "Entrenamientos y Evaluaciones" (junto a Nivelación). Muestra la siguiente
 * evaluación por delante; al llegar el alumno a esa lección presenta TODOS sus
 * cuestionarios EN ORDEN (cada uno con su título y temporizador). Cada cuestionario
 * se califica y guarda por separado.
 */
export default function EvaluacionCard() {
  const { data, refetch } = useQuery(
    'evaluacion-estado',
    () => fetch('/api/postgres/panel-estudiante/evaluacion', { cache: 'no-store' })
      .then((r) => r.json()).catch(() => ({ available: false })),
    { staleTime: 60_000, refetchOnWindowFocus: false }
  )

  const d: any = data || {}
  const reached = !!d.reached
  const label = d.evalCode || 'evaluación'
  const cuestionarios: Cuest[] = Array.isArray(d.cuestionarios) ? d.cuestionarios : []
  const enviados: Set<string> = new Set(Array.isArray(d.enviados) ? d.enviados : [])
  const resultados: Array<{ cuestionarioId: string; score: number; total: number }> = Array.isArray(d.resultados) ? d.resultados : []
  const resultadoDe = (id: string) => resultados.find((r) => r.cuestionarioId === id)
  const pendientes = cuestionarios.filter((c) => !enviados.has(c.id))
  const siguiente = pendientes[0] || null

  const [phase, setPhase] = useState<'idle' | 'confirm' | 'eval' | 'done'>('idle')
  const [activo, setActivo] = useState<Cuest | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [remaining, setRemaining] = useState(30 * 60)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ score: number; total: number } | null>(null)
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
      setResult({ score: res.score, total: res.total })
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
    setAnswers({}); setRemaining((activo.minutos > 0 ? activo.minutos : 30) * 60); setResult(null)
    iniciadaRef.current = new Date().toISOString()
    setPhase('eval')
  }
  const cerrarDone = () => { setPhase('idle'); setActivo(null) }

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
  const total = cuestionarios.length
  const hechos = cuestionarios.filter((c) => enviados.has(c.id)).length

  return (
    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardDocumentCheckIcon className="h-5 w-5 text-orange-600" />
        <h3 className="text-sm font-bold text-orange-800 uppercase tracking-wide">Entrenamientos y Evaluaciones</h3>
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
          <p className="text-sm text-gray-500 mt-1">No tienes una evaluación próxima.</p>
        )
      ) : !d.tieneEvaluacion ? (
        <p className="text-sm text-gray-500 mt-1">La evaluación de esta lección aún no está disponible.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700">
            Has avanzado a <strong>{label}</strong>. {total > 1
              ? <>Debes presentar los <strong>{total} cuestionarios</strong> en orden.</>
              : <>Espera las instrucciones en la sesión de tu guía para realizar la evaluación.</>}
          </p>
          {d.completa && <p className="text-xs text-emerald-700 font-medium mt-1">✓ Completaste todos los cuestionarios.</p>}
          {total > 1 && !d.completa && <p className="text-xs text-gray-500 mt-1">Progreso: {hechos}/{total}</p>}

          <ul className="mt-3 space-y-2">
            {cuestionarios.map((c, i) => {
              const done = enviados.has(c.id)
              const esSiguiente = siguiente?.id === c.id
              const r = resultadoDe(c.id)
              return (
                <li key={c.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${done ? 'border-emerald-200 bg-emerald-50' : esSiguiente ? 'border-orange-300 bg-white' : 'border-gray-200 bg-white/60'}`}>
                  {done ? <CheckCircleIcon className="h-5 w-5 text-emerald-600 shrink-0" />
                    : esSiguiente ? <ClipboardDocumentCheckIcon className="h-5 w-5 text-orange-500 shrink-0" />
                    : <LockClosedIcon className="h-5 w-5 text-gray-300 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.titulo || `Cuestionario ${i + 1}`}</p>
                    <p className="text-[11px] text-gray-500">{c.preguntas.length} pregunta(s) · {c.minutos} min{done && r ? ` · ${r.score}/${r.total}` : ''}</p>
                  </div>
                  {done ? <span className="text-[11px] text-emerald-700 font-semibold shrink-0">Enviado</span>
                    : esSiguiente ? (
                      <button type="button" onClick={() => presentar(c)}
                        className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded-lg hover:bg-orange-700 shrink-0">Presentar</button>
                    ) : <span className="text-[11px] text-gray-400 shrink-0">En espera</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {/* Modal 1 — confirmación */}
      {phase === 'confirm' && activo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <ClipboardDocumentCheckIcon className="h-10 w-10 text-orange-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900 mb-1">{activo.titulo}</h3>
            <p className="text-sm text-gray-600">Tu guía ya te explicó cómo presentar la evaluación. Tendrás {activo.minutos} minutos para responder este cuestionario ({activo.preguntas.length} preguntas).</p>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={() => setPhase('idle')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Salir</button>
              <button type="button" onClick={aceptar}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Aceptar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2 — cuestionario con timer */}
      {phase === 'eval' && activo && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6">
            <div className="sticky top-0 bg-white border-b border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 truncate pr-3">{activo.titulo}</h3>
              <div className={`flex items-center gap-1.5 text-sm font-semibold shrink-0 ${remaining <= 60 ? 'text-red-600' : 'text-gray-700'}`}>
                <ClockIcon className="h-5 w-5" /> {mmss}
              </div>
            </div>
            <div className="p-5 space-y-5">
              {activo.preguntas.length === 0 ? (
                <p className="text-sm text-gray-500">No hay preguntas cargadas.</p>
              ) : activo.preguntas.map((q, i) => {
                const key = String(q.id ?? i)
                const opts = q.type === 'true_false' ? ['Verdadero', 'Falso'] : q.options
                return (
                  <div key={key} className="border border-gray-100 rounded-xl p-4">
                    <p className="text-sm font-semibold text-gray-500 mb-1">Pregunta {i + 1}</p>
                    <div className="text-sm text-gray-800 mb-3"><MathText block>{q.question}</MathText></div>
                    <div className="space-y-2">
                      {opts.map((opt, oj) => (
                        <label key={oj} className="flex items-start gap-2 cursor-pointer">
                          <input type="radio" name={`q-${key}`} className="mt-1"
                            checked={answers[key] === opt}
                            onChange={() => setAnswers((a) => ({ ...a, [key]: opt }))} />
                          <span className="text-sm text-gray-700"><MathText>{opt}</MathText></span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 rounded-b-2xl px-5 py-3 flex justify-between">
              <button type="button" onClick={() => { if (confirm('¿Salir sin enviar? Se perderán tus respuestas.')) setPhase('idle') }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm">Salir sin enviar</button>
              <button type="button" onClick={submit} disabled={submitting}
                className="px-5 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 disabled:opacity-50 text-sm">
                {submitting ? 'Enviando…' : 'Enviar cuestionario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3 — enviado */}
      {phase === 'done' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Cuestionario enviado ✅</h3>
            <p className="text-sm text-gray-600">Tus respuestas quedaron registradas.</p>
            {result && <p className="text-2xl font-bold text-orange-700 mt-3">{result.score} / {result.total}</p>}
            {(() => {
              const proximo = cuestionarios.find((c) => c.id !== activo?.id && !enviados.has(c.id)) || null
              return proximo ? (
                <div className="mt-5 flex justify-center gap-3">
                  <button type="button" onClick={cerrarDone} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Más tarde</button>
                  <button type="button" onClick={() => presentar(proximo)} className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Siguiente cuestionario →</button>
                </div>
              ) : (
                <button type="button" onClick={cerrarDone} className="mt-5 px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Cerrar</button>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
