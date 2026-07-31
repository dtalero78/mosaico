'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'react-query'
import toast from 'react-hot-toast'
import { ClipboardDocumentCheckIcon, ClockIcon } from '@heroicons/react/24/outline'
import MathText from '@/components/ecuaciones/MathText'

interface Pregunta { id: any; type: string; question: string; options: string[] }

/**
 * Card "EVALUACIÓN" (columna derecha, junto a Nivelación). Muestra la SIGUIENTE
 * evaluación por delante; al avanzar el alumno a esa lección se habilita el
 * acceso: botón → modal de confirmación ("tu guía ya te explicó…") → evaluación
 * con timer de 30 min → envío (se califica y guarda en EVALUACION_RESPUESTAS).
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
  const label = d.evalCode || 'evaluación'  // nombre del módulo: "Evaluación 01" / "Entrenamiento 01"
  const durMin = Number(d.duracionMin) > 0 ? Number(d.duracionMin) : 30
  const preguntas: Pregunta[] = Array.isArray(d.preguntas) ? d.preguntas : []

  const [phase, setPhase] = useState<'idle' | 'confirm' | 'eval' | 'done'>('idle')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [remaining, setRemaining] = useState(30 * 60)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ score: number; total: number } | null>(null)
  const iniciadaRef = useRef<string>('')

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const respuestas = preguntas.map((q, i) => ({ qId: q.id ?? i, selected: answers[String(q.id ?? i)] ?? null }))
      const res = await fetch('/api/postgres/panel-estudiante/evaluacion/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas, iniciadaEn: iniciadaRef.current }),
      }).then((r) => r.json())
      if (res.error) throw new Error(res.error)
      setResult({ score: res.score, total: res.total })
      setPhase('done')
      refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Error al enviar la evaluación')
    } finally {
      setSubmitting(false)
    }
  }

  // Timer de la evaluación
  useEffect(() => {
    if (phase !== 'eval') return
    if (remaining <= 0) { submit(); return }
    const t = setTimeout(() => setRemaining((s) => s - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remaining])

  const aceptar = () => {
    setAnswers({}); setRemaining(durMin * 60); setResult(null)
    iniciadaRef.current = new Date().toISOString()
    setPhase('eval')
  }

  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`

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
            <p className="text-xs text-gray-500 mt-2">Se habilitará cuando avances a esa lección.</p>
          </>
        ) : (
          <p className="text-sm text-gray-500 mt-1">No tienes una evaluación próxima.</p>
        )
      ) : d.yaEnviada ? (
        <>
          <p className="text-sm text-gray-700">Ya presentaste <strong>{label}</strong>.</p>
          {d.resultado && (
            <p className="text-xs text-gray-500 mt-1">Puntaje registrado: {d.resultado.score} / {d.resultado.total}</p>
          )}
        </>
      ) : d.tieneEvaluacion ? (
        <>
          <p className="text-sm text-gray-700">
            Has avanzado a <strong>{label}</strong>. Espera las instrucciones en la sesión de tu guía para
            realizar la evaluación.
          </p>
          <button type="button" onClick={() => setPhase('confirm')}
            className="mt-3 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700">
            Acceder a la evaluación
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-500 mt-1">La evaluación de esta lección aún no está disponible.</p>
      )}

      {/* Modal 1 — confirmación */}
      {phase === 'confirm' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <ClipboardDocumentCheckIcon className="h-10 w-10 text-orange-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900 mb-1">{label}</h3>
            <p className="text-sm text-gray-600">Tu guía ya te explicó cómo presentar la evaluación. Tendrás {durMin} minutos para responderla.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={() => setPhase('idle')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Salir</button>
              <button type="button" onClick={aceptar}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Aceptar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2 — evaluación con timer */}
      {phase === 'eval' && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-6">
            <div className="sticky top-0 bg-white border-b border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">{label}</h3>
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${remaining <= 60 ? 'text-red-600' : 'text-gray-700'}`}>
                <ClockIcon className="h-5 w-5" /> {mmss}
              </div>
            </div>
            <div className="p-5 space-y-5">
              {preguntas.length === 0 ? (
                <p className="text-sm text-gray-500">No hay preguntas cargadas.</p>
              ) : preguntas.map((q, i) => {
                const key = String(q.id ?? i)
                const opts = q.type === 'true_false' ? ['Verdadero', 'Falso'] : q.options
                return (
                  <div key={key} className="border border-gray-100 rounded-xl p-4">
                    <p className="text-sm font-semibold text-gray-500 mb-1">Pregunta {i + 1}</p>
                    <div className="text-sm text-gray-800 mb-3"><MathText>{q.question}</MathText></div>
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
                {submitting ? 'Enviando…' : 'Enviar evaluación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3 — enviada */}
      {phase === 'done' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Evaluación enviada ✅</h3>
            <p className="text-sm text-gray-600">Tus respuestas quedaron registradas.</p>
            {result && <p className="text-2xl font-bold text-orange-700 mt-3">{result.score} / {result.total}</p>}
            <button type="button" onClick={() => setPhase('idle')}
              className="mt-5 px-4 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
