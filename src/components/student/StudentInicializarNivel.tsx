'use client'

import { useState, useEffect } from 'react'
import { ExclamationTriangleIcon, XMarkIcon, CheckCircleIcon, NoSymbolIcon } from '@heroicons/react/24/outline'

interface Props {
  studentId: string
  studentName: string
  onClose: () => void
  onSuccess: () => void
}

type Step = 'loading' | 'blocked' | 'nivel-bloqueado' | 'info' | 'form' | 'confirm' | 'done'

export default function StudentInicializarNivel({ studentId, studentName, onClose, onSuccess }: Props) {
  const [step, setStep]             = useState<Step>('loading')
  const [info, setInfo]             = useState<any>(null)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  // Form fields
  const [motivo, setMotivo]         = useState('')
  const [autorizadoPor, setAutorizado] = useState('')

  // Result
  const [result, setResult]         = useState<any>(null)

  // Load preflight info
  useEffect(() => {
    const load = async () => {
      try {
        const res  = await fetch(`/api/postgres/students/${studentId}/inicializar-nivel`)
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Error al cargar información')
        setInfo(json)
        if (json.nivelBloqueado) setStep('nivel-bloqueado')
        else if (json.done)      setStep('blocked')
        else                     setStep('info')
      } catch (e: any) {
        setError(e.message)
        setStep('info')
      }
    }
    load()
  }, [studentId])

  const handleExecute = async () => {
    if (!motivo.trim())       { setError('El motivo es requerido'); return }
    if (!autorizadoPor.trim()) { setError('El nombre del autorizante es requerido'); return }
    setError('')
    setLoading(true)
    try {
      const res  = await fetch(`/api/postgres/students/${studentId}/inicializar-nivel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo, autorizadoPor }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Error al inicializar nivel')
      setResult(json)
      setStep('done')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fmtDate = () => new Date().toLocaleString('es-CO', {
    dateStyle: 'medium', timeStyle: 'short',
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />
            <h2 className="text-base font-semibold text-gray-900">Reiniciar Nivel</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* LOADING */}
          {step === 'loading' && (
            <div className="text-center py-8 text-gray-500 text-sm">Cargando información...</div>
          )}

          {/* NIVEL BLOQUEADO — ESS, WELCOME o DONE */}
          {step === 'nivel-bloqueado' && info && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <NoSymbolIcon className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800">Nivel no permitido</p>
                  <p className="text-sm text-amber-700 mt-1">
                    El proceso <strong>Reiniciar Nivel</strong> no está disponible para estudiantes en nivel{' '}
                    <strong className="uppercase">{info.nivel}</strong>.
                  </p>
                  <p className="text-sm text-amber-600 mt-2">
                    Este proceso solo aplica a niveles académicos regulares (BN1–F3). Los niveles{' '}
                    <strong>ESS</strong>, <strong>WELCOME</strong> y <strong>DONE</strong> están excluidos.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* BLOCKED — ya se realizó una vez */}
          {step === 'blocked' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                <NoSymbolIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-red-800">Proceso no disponible</p>
                  <p className="text-sm text-red-700 mt-0.5">
                    Este proceso solo puede realizarse <strong>una vez</strong> por estudiante y ya fue ejecutado.
                  </p>
                </div>
              </div>
              {info?.auditData && (
                <div className="bg-gray-50 rounded-lg p-4 text-xs space-y-1 text-gray-600">
                  <p><span className="font-medium">Fecha:</span> {info.auditData.fecha ? new Date(info.auditData.fecha).toLocaleString('es-CO') : '—'}</p>
                  <p><span className="font-medium">Nivel reiniciado:</span> {info.auditData.nivel} → {info.auditData.stepNuevo}</p>
                  <p><span className="font-medium">Step anterior:</span> {info.auditData.stepAnterior}</p>
                  <p><span className="font-medium">Motivo:</span> {info.auditData.motivo}</p>
                  <p><span className="font-medium">Autorizado por:</span> {info.auditData.autorizadoPor}</p>
                  <p><span className="font-medium">Realizado por:</span> {info.auditData.realizadoPor}</p>
                  <p><span className="font-medium">Bookings eliminados:</span> {info.auditData.bookingsEliminados}</p>
                </div>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* PASO 1 — Información y advertencia */}
          {step === 'info' && info && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1.5 text-sm">
                <p className="font-semibold text-blue-900">{studentName}</p>
                <p className="text-blue-700">Nivel actual: <strong>{info.nivel}</strong> — Step actual: <strong>{info.stepActual}</strong></p>
                <p className="text-blue-700">Quedará en: <strong>{info.nivel} — {info.firstStep || '—'}</strong></p>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-orange-800 space-y-1">
                    <p className="font-semibold">Advertencias:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-orange-700">
                      <li>Se eliminarán <strong>{info.bookingCount} registros</strong> de ACADEMICA_BOOKINGS para el nivel <strong>{info.nivel}</strong></li>
                      <li>El estudiante quedará en <strong>{info.nivel} — {info.firstStep}</strong></li>
                      <li>Esta acción es <strong>irreversible</strong> y solo puede realizarse <strong>una vez</strong></li>
                      <li>Se generará un registro de auditoría</li>
                    </ul>
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-between">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                  Abandonar
                </button>
                <button type="button" onClick={() => { setError(''); setStep('form') }}
                  className="px-5 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 font-medium">
                  Continuar
                </button>
              </div>
            </div>
          )}

          {/* PASO 2 — Formulario de auditoría */}
          {step === 'form' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Complete los datos de auditoría requeridos para continuar.</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Motivo de inicialización *
                </label>
                <textarea
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  rows={3}
                  placeholder="Describa el motivo por el cual se inicializa el nivel..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Autorizado por *
                </label>
                <input
                  type="text"
                  value={autorizadoPor}
                  onChange={e => setAutorizado(e.target.value)}
                  placeholder="Nombre completo de quien autoriza"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                <span className="font-medium">Fecha y hora de registro:</span> {fmtDate()} (se toma al confirmar)
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-between">
                <button type="button" onClick={() => { setError(''); setStep('info') }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                  Atrás
                </button>
                <button type="button" onClick={() => {
                  if (!motivo.trim()) { setError('El motivo es requerido'); return }
                  if (!autorizadoPor.trim()) { setError('El nombre del autorizante es requerido'); return }
                  setError(''); setStep('confirm')
                }}
                  className="px-5 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 font-medium">
                  Ver resumen
                </button>
              </div>
            </div>
          )}

          {/* PASO 3 — Confirmación final */}
          {step === 'confirm' && info && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
                <p className="font-semibold text-gray-800 text-base">Resumen de la acción</p>
                <div className="space-y-1 text-gray-700">
                  <p>👤 Estudiante: <strong>{studentName}</strong></p>
                  <p>📚 Nivel que se reinicia: <strong>{info.nivel}</strong></p>
                  <p>📍 Step anterior: <strong>{info.stepActual}</strong> → Step nuevo: <strong>{info.firstStep}</strong></p>
                  <p>🗑 Registros de agendamiento a eliminar: <strong className="text-red-600">{info.bookingCount}</strong></p>
                  <p>📝 Motivo: {motivo}</p>
                  <p>✅ Autorizado por: {autorizadoPor}</p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <strong>¡Atención!</strong> Esta acción es irreversible y no podrá repetirse. ¿Confirma que desea continuar?
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-between">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                  Abandonar
                </button>
                <button type="button" onClick={handleExecute} disabled={loading}
                  className="px-5 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 font-medium disabled:opacity-50">
                  {loading ? 'Ejecutando...' : 'Confirmar y ejecutar'}
                </button>
              </div>
            </div>
          )}

          {/* DONE */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircleIcon className="w-7 h-7 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-800">Nivel inicializado correctamente</p>
                  <p className="text-sm text-green-700 mt-0.5">
                    {result.nivel} — Step actualizado a <strong>{result.stepNuevo}</strong>. {result.bookingsEliminados} registro(s) eliminados.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => { onSuccess(); onClose() }}
                  className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium">
                  Aceptar y recargar
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
