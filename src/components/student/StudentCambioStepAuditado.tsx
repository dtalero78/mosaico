'use client'

import { useState, useEffect } from 'react'
import { XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, AcademicCapIcon } from '@heroicons/react/24/outline'

interface Props {
  studentId: string       // ACADEMICA _id
  studentName: string
  currentStep: string
  currentNivel: string
  onClose: () => void
  onSuccess: () => void
}

type ModalStep = 'form' | 'confirm' | 'done'

interface StepOption { label: string; value: string; nivel: string }

export default function StudentCambioStepAuditado({
  studentId, studentName, currentStep, currentNivel, onClose, onSuccess,
}: Props) {
  const [modalStep, setModalStep]       = useState<ModalStep>('form')
  const [stepOptions, setStepOptions]   = useState<StepOption[]>([])
  const [loadingSteps, setLoadingSteps] = useState(true)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  // Formulario
  const [newStep, setNewStep]           = useState('')
  const [motivo, setMotivo]             = useState('')
  const [autorizadoPor, setAutorizado]  = useState('')
  const [comentario, setComentario]     = useState('')

  // Resultado
  const [result, setResult]             = useState<any>(null)

  // ── Cargar steps de NIVELES ───────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const res  = await fetch('/api/postgres/niveles')
        const json = await res.json()
        if (json.success && json.niveles) {
          const opts: StepOption[] = []
          json.niveles.forEach((nivel: any) => {
            if (Array.isArray(nivel.steps)) {
              nivel.steps.forEach((step: string) => {
                if (!opts.find(o => o.value === step)) {
                  opts.push({ label: `${nivel.code} — ${step}`, value: step, nivel: nivel.code })
                }
              })
            }
          })
          // Ordenar numéricamente
          opts.sort((a, b) => {
            const na = parseInt(a.value.replace(/[^0-9]/g, '')) || 0
            const nb = parseInt(b.value.replace(/[^0-9]/g, '')) || 0
            return na - nb
          })
          setStepOptions(opts)
        }
      } catch { setError('No se pudieron cargar los steps') }
      finally { setLoadingSteps(false) }
    }
    load()
  }, [])

  const selectedOption = stepOptions.find(o => o.value === newStep)

  // ── Validar formulario ─────────────────────────────────────────────────────
  const validateForm = (): string => {
    if (!newStep)          return 'Selecciona el nuevo step'
    if (!motivo.trim())    return 'El motivo es requerido'
    if (!autorizadoPor.trim()) return 'El autorizante es requerido'
    return ''
  }

  const handleNext = () => {
    const msg = validateForm()
    if (msg) { setError(msg); return }
    setError('')
    setModalStep('confirm')
  }

  // ── Ejecutar ───────────────────────────────────────────────────────────────
  const handleExecute = async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch(`/api/postgres/students/${studentId}/cambio-step-auditado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStep, motivo, autorizadoPor, comentario }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Error al cambiar step')
      setResult(json)
      setModalStep('done')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fmtNow = () => new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <AcademicCapIcon className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-semibold text-gray-900">Cambio Step — Auditado</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* ── PASO 1: Formulario ──────────────────────────────────────── */}
          {modalStep === 'form' && (
            <div className="space-y-4">
              {/* Info estudiante */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-indigo-800">{studentName}</p>
                <p className="text-indigo-600 mt-0.5">
                  Nivel actual: <strong>{currentNivel}</strong> — Step actual: <strong>{currentStep}</strong>
                </p>
              </div>

              {/* Nuevo step */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nuevo Step *</label>
                {loadingSteps ? (
                  <p className="text-sm text-gray-400">Cargando steps...</p>
                ) : (
                  <select
                    value={newStep}
                    onChange={e => setNewStep(e.target.value)}
                    title="Seleccionar nuevo step"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Selecciona un step...</option>
                    {stepOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo del cambio *</label>
                <textarea
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                  rows={2}
                  placeholder="Describa el motivo del cambio de step..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Autorizado por */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Autorizado por *</label>
                <input
                  type="text"
                  value={autorizadoPor}
                  onChange={e => setAutorizado(e.target.value)}
                  placeholder="Nombre completo de quien autoriza"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Comentario para historial */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comentario para historial
                  <span className="ml-1 text-xs text-gray-400">(opcional — se agregará como Académico → General)</span>
                </label>
                <textarea
                  value={comentario}
                  onChange={e => setComentario(e.target.value)}
                  rows={2}
                  placeholder="Observaciones adicionales que quedarán en el tab Comentarios..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Fecha automática */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
                <span className="font-medium">Fecha y hora:</span> {fmtNow()} (se registra al confirmar)
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-between pt-1">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button type="button" onClick={handleNext}
                  className="px-5 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Ver resumen →
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 2: Confirmación ────────────────────────────────────── */}
          {modalStep === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
                <p className="font-semibold text-gray-900 text-base">Resumen del cambio</p>
                <p>👤 <strong>{studentName}</strong></p>
                <p>
                  📚 Step: <strong className="text-red-600">{currentNivel} — {currentStep}</strong>
                  {' → '}
                  <strong className="text-green-600">{selectedOption?.nivel} — {newStep}</strong>
                </p>
                <p>📝 Motivo: {motivo}</p>
                <p>✅ Autorizado por: {autorizadoPor}</p>
                {comentario && (
                  <p>💬 Comentario: <span className="text-gray-600">{comentario}</span></p>
                )}
              </div>

              {comentario && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                  El comentario se agregará en el tab Comentarios como <strong>Académico → General</strong>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                Esta acción actualizará el step en ACADEMICA y PEOPLE y quedará registrada en el historial de auditoría.
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-between">
                <button type="button" onClick={() => { setError(''); setModalStep('form') }}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
                  ← Atrás
                </button>
                <button type="button" onClick={handleExecute} disabled={loading}
                  className="px-5 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? 'Ejecutando...' : 'Confirmar cambio'}
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Éxito ───────────────────────────────────────────── */}
          {modalStep === 'done' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircleIcon className="w-7 h-7 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-800">Step actualizado correctamente</p>
                  <p className="text-sm text-green-700 mt-0.5">
                    {currentStep} → <strong>{result.stepNuevo}</strong>
                    {result.nivelNuevo && ` (${result.nivelNuevo})`}
                  </p>
                  {comentario && (
                    <p className="text-xs text-green-600 mt-1">Comentario agregado al historial ✓</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => { onSuccess(); onClose() }}
                  className="px-5 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
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
