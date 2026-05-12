'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import {
  useComplementariaEligibility,
  useComplementariaAttempts,
  useGenerateQuestions,
  useGradeAnswers,
} from '@/hooks/use-complementaria'

function ComplementariaContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const step  = searchParams.get('step')  || ''
  const nivel = searchParams.get('nivel') || ''

  const eligibilityQuery = useComplementariaEligibility(step)
  const attemptsQuery = useComplementariaAttempts(step)
  const generateMutation = useGenerateQuestions()
  const gradeMutation = useGradeAnswers()

  const [currentAttempt, setCurrentAttempt] = useState<any>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [gradeResult, setGradeResult] = useState<any>(null)

  const eligibility = eligibilityQuery.data
  const attempts = attemptsQuery.data?.attempts || []

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync(step)
      // result = { success, attemptId, questions, attemptNumber }
      setCurrentAttempt({
        _id: result.attemptId,
        questions: result.questions,
        attemptNumber: result.attemptNumber,
      })
      setAnswers(new Array(result.questions.length).fill(''))
      setGradeResult(null)
    } catch {
      // Error handled by hook
    }
  }

  const handleGrade = async () => {
    if (!currentAttempt) return
    try {
      const result = await gradeMutation.mutateAsync({
        attemptId: currentAttempt._id,
        answers,
        step,
      })
      setGradeResult(result)
    } catch {
      // Error handled by hook
    }
  }

  const handleRetry = () => {
    setCurrentAttempt(null)
    setAnswers([])
    setGradeResult(null)
  }

  const allAnswered = answers.length > 0 && answers.every((a) => a.trim().length > 0)

  if (!step) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">No se especificó un step.</p>
          <button
            onClick={() => router.push('/panel-estudiante')}
            className="mt-4 text-blue-600 hover:underline text-sm"
          >
            Volver al panel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push('/panel-estudiante')}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Actividad Complementaria</h1>
            <p className="text-sm text-gray-500">{step}</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Loading */}
        {eligibilityQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <ArrowPathIcon className="h-6 w-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">Verificando elegibilidad...</span>
          </div>
        )}

        {/* Not eligible */}
        {eligibility && !eligibility.eligible && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-yellow-800 mb-1">No elegible</h3>
            <p className="text-sm text-yellow-700">{eligibility.reason}</p>
            <button
              onClick={() => router.push('/panel-estudiante')}
              className="mt-3 text-sm text-yellow-800 hover:underline"
            >
              Volver al panel
            </button>
          </div>
        )}

        {/* Eligible - Show info & action */}
        {eligibility?.eligible && !currentAttempt && !gradeResult && (
          <>
            {/* Info Card */}
            {(() => {
              const remaining    = 3 - (eligibility.attemptsUsed || 0)
              const displayNivel = (eligibility as any)?.nivel || nivel || '—'
              const displayStep  = (eligibility as any)?.step  || step  || '—'
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-blue-800 mb-3">
                    Actividad Complementaria disponible
                  </h3>
                  <ul className="text-sm text-blue-700 space-y-2 mb-5">
                    <li>
                      • Antes de presentar la actividad, revisa el material correspondiente al Nivel{' '}
                      <strong>{displayNivel}</strong> - <strong>{displayStep}</strong>
                    </li>
                    <li>• Basado en el contenido del material se generarán <strong>10 preguntas</strong></li>
                    <li>• Necesitas <strong>80% o más</strong> para aprobar</li>
                    <li>
                      {remaining > 0 ? (
                        <>• Tienes <strong>{remaining} {remaining === 1 ? 'intento' : 'intentos'}</strong> restante{remaining === 1 ? '' : 's'}</>
                      ) : (
                        <>• No tienes más intentos disponibles. Por favor <strong>comunícate con Servicio al Cliente</strong></>
                      )}
                    </li>
                  </ul>
                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generateMutation.isLoading}
                      className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {generateMutation.isLoading ? (
                        <span className="flex items-center gap-2">
                          <ArrowPathIcon className="h-4 w-4 animate-spin" />
                          Generando preguntas...
                        </span>
                      ) : (
                        'Generar Actividad'
                      )}
                    </button>
                  )}
                </div>
              )
            })()}

            {/* Previous Attempts */}
            {attempts.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Intentos anteriores</h3>
                <div className="space-y-2">
                  {attempts.map((a: any) => (
                    <div
                      key={a._id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        a.passed ? 'bg-green-50' : a.status === 'IN_PROGRESS' ? 'bg-yellow-50' : 'bg-red-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {a.passed ? (
                          <CheckCircleIcon className="h-5 w-5 text-green-600" />
                        ) : a.status === 'IN_PROGRESS' ? (
                          <ArrowPathIcon className="h-5 w-5 text-yellow-600" />
                        ) : (
                          <XCircleIcon className="h-5 w-5 text-red-500" />
                        )}
                        <span className="text-sm font-medium text-gray-900">
                          Intento {a.attemptNumber}
                        </span>
                      </div>
                      <div className="text-right">
                        {a.score !== null && a.score !== undefined ? (
                          <span className={`text-sm font-bold ${a.passed ? 'text-green-600' : 'text-red-600'}`}>
                            {a.score}%
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-600">En progreso</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Questions Form */}
        {currentAttempt && !gradeResult && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">
                  Intento {currentAttempt.attemptNumber} de 3
                </h3>
                <span className="text-xs text-gray-400">
                  {answers.filter((a) => a.trim().length > 0).length} / {currentAttempt.questions.length} respondidas
                </span>
              </div>

              <div className="space-y-6">
                {currentAttempt.questions.map((q: any, idx: number) => (
                  <div key={idx} className="border-b border-gray-100 pb-5 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      {idx + 1}. {q.question}
                    </p>

                    {q.type === 'multiple_choice' || q.type === 'true_false' ? (
                      <div className="space-y-2">
                        {q.options.map((opt: string, optIdx: number) => (
                          <label
                            key={optIdx}
                            className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                              answers[idx] === opt
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`q-${idx}`}
                              value={opt}
                              checked={answers[idx] === opt}
                              onChange={() => {
                                const newAnswers = [...answers]
                                newAnswers[idx] = opt
                                setAnswers(newAnswers)
                              }}
                              className="text-blue-600"
                            />
                            <span className="text-sm text-gray-700">{opt}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={answers[idx] || ''}
                        onChange={(e) => {
                          const newAnswers = [...answers]
                          newAnswers[idx] = e.target.value
                          setAnswers(newAnswers)
                        }}
                        rows={3}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="Escribe tu respuesta..."
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                onClick={handleGrade}
                disabled={!allAnswered || gradeMutation.isLoading}
                className="px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {gradeMutation.isLoading ? (
                  <span className="flex items-center gap-2">
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    Calificando...
                  </span>
                ) : (
                  'Finalizar y Calificar'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {gradeResult && (
          <div className="space-y-4">
            {/* Score Card */}
            <div
              className={`rounded-xl p-6 text-center ${
                gradeResult.passed
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              {gradeResult.passed ? (
                <CheckCircleIcon className="h-12 w-12 text-green-600 mx-auto mb-3" />
              ) : (
                <XCircleIcon className="h-12 w-12 text-red-500 mx-auto mb-3" />
              )}
              <p
                className={`text-3xl font-bold mb-2 ${
                  gradeResult.passed ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {gradeResult.score}%
              </p>
              <p
                className={`text-sm font-medium ${
                  gradeResult.passed ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {gradeResult.passed ? 'Aprobado' : 'No aprobado'}
              </p>
              {gradeResult.passed && gradeResult.advancement && (
                <p className="text-sm text-green-600 mt-2">
                  Has avanzado al siguiente step.
                </p>
              )}
              {!gradeResult.passed && (
                <p className="text-sm text-red-600 mt-2">
                  Necesitas 80% para aprobar.
                  {gradeResult.attemptsRemaining > 0
                    ? ` Te quedan ${gradeResult.attemptsRemaining} intentos.`
                    : ' No tienes más intentos disponibles.'}
                </p>
              )}
            </div>

            {/* Feedback per question */}
            {gradeResult.results && gradeResult.results.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Detalle por pregunta</h3>
                <div className="space-y-4">
                  {gradeResult.results.map((r: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        r.correct ? 'bg-green-50' : 'bg-red-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {r.correct ? (
                          <CheckCircleIcon className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {idx + 1}. {currentAttempt?.questions?.[idx]?.question || `Pregunta ${idx + 1}`}
                          </p>
                          {r.feedback && (
                            <p className="text-xs text-gray-600 mt-1">{r.feedback}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between">
              <button
                onClick={() => router.push('/panel-estudiante')}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Volver al panel
              </button>
              {!gradeResult.passed && gradeResult.attemptsRemaining > 0 && (
                <button
                  onClick={handleRetry}
                  className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Intentar de nuevo
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ActividadesComplementariasPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-gray-600">Cargando...</p>
          </div>
        </div>
      }
    >
      <ComplementariaContent />
    </Suspense>
  )
}
