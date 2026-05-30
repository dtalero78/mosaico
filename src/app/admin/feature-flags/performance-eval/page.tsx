'use client'

import { useEffect, useState } from 'react'
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { useFeatureFlag, useUpdateFeatureFlag } from '@/hooks/use-evaluations'

type Mode = 'off' | 'beta' | 'on'

/**
 * /admin/feature-flags/performance-eval — SUPER_ADMIN only.
 * Controla el flag global `performance_eval_mode` y la whitelist de emails
 * para modo BETA. El cambio surte efecto inmediato (caché del flag 30s).
 */
export default function PerformanceEvalFlagPage() {
  const flagQ = useFeatureFlag()
  const updateMut = useUpdateFeatureFlag()
  const [mode, setMode] = useState<Mode>('off')
  const [emailsText, setEmailsText] = useState('')

  useEffect(() => {
    if (flagQ.data) {
      setMode((flagQ.data.mode || 'off') as Mode)
      setEmailsText((flagQ.data.betaUsers || []).join('\n'))
    }
  }, [flagQ.data])

  const betaUsers = emailsText
    .split(/[\n,;]+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))

  const invalidLines = emailsText
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))

  const handleSave = () => {
    updateMut.mutate({ mode, betaUsers })
  }

  const currentMode = (flagQ.data?.mode || 'off') as Mode
  const dirty = currentMode !== mode || (flagQ.data?.betaUsers || []).sort().join(',') !== betaUsers.sort().join(',')

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-5 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flag · Performance Evaluation</h1>
          <p className="text-sm text-gray-500">
            Controla la visibilidad global del módulo de evaluación de advisors. Acceso solo SUPER_ADMIN.
          </p>
        </div>

        {/* Estado actual */}
        <div className={`rounded-xl border p-4 ${
          currentMode === 'on' ? 'bg-green-50 border-green-300' :
          currentMode === 'beta' ? 'bg-amber-50 border-amber-300' :
          'bg-gray-50 border-gray-300'
        }`}>
          <p className="text-sm">
            <strong>Estado actual:</strong> <code className="px-1 bg-white rounded">{currentMode}</code>
            {currentMode === 'on' && ' — visible para TODOS los estudiantes.'}
            {currentMode === 'beta' && ` — visible solo para ${(flagQ.data?.betaUsers || []).length} email(s) de la whitelist.`}
            {currentMode === 'off' && ' — feature oculta para todos. Nadie ve la tarjeta "Sin Evaluar", el hard block, ni el modal de evaluación.'}
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700 mb-2">Modo</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="mode" value="off" checked={mode === 'off'} onChange={() => setMode('off')} className="mt-0.5" />
                <div>
                  <span className="font-medium text-gray-800">OFF</span>
                  <p className="text-xs text-gray-500">Nadie ve la feature. Recomendado mientras se desarrolla / valida.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="mode" value="beta" checked={mode === 'beta'} onChange={() => setMode('beta')} className="mt-0.5" />
                <div>
                  <span className="font-medium text-gray-800">BETA</span>
                  <p className="text-xs text-gray-500">Solo los emails listados abajo ven la feature. Útil para probar con 2-5 estudiantes reales en producción sin afectar al resto.</p>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="radio" name="mode" value="on" checked={mode === 'on'} onChange={() => setMode('on')} className="mt-0.5" />
                <div>
                  <span className="font-medium text-gray-800">ON</span>
                  <p className="text-xs text-gray-500">Visible para TODOS los estudiantes. Activar solo cuando la feature esté validada.</p>
                </div>
              </label>
            </div>
          </fieldset>

          {mode === 'beta' && (
            <div>
              <label htmlFor="pe-emails" className="block text-sm font-medium text-gray-700 mb-1">
                Beta testers · emails (uno por línea)
              </label>
              <textarea
                id="pe-emails"
                rows={6}
                value={emailsText}
                onChange={e => setEmailsText(e.target.value)}
                placeholder="estudiante1@email.com&#10;estudiante2@email.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                {betaUsers.length} email(s) válido(s). Los inválidos se ignoran al guardar.
              </p>
              {invalidLines.length > 0 && (
                <p className="text-[11px] text-amber-700 mt-1">
                  ⚠ {invalidLines.length} línea(s) no parecen email válido y se descartarán: {invalidLines.slice(0, 3).join(', ')}{invalidLines.length > 3 ? '…' : ''}
                </p>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] text-gray-400">
              El cambio surte efecto en máximo 30 segundos (caché interno del flag).
            </p>
            <button type="button" onClick={handleSave}
              disabled={!dirty || updateMut.isLoading}
              className="inline-flex items-center gap-1 px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold">
              {updateMut.isLoading ? 'Guardando…' : (<><CheckCircleIcon className="h-4 w-4" /> Guardar</>)}
            </button>
          </div>
        </div>

        {/* Ayuda */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
          <p className="font-semibold mb-1">Flujo recomendado:</p>
          <ol className="list-decimal ml-5 space-y-1 text-[13px]">
            <li>Desarrollo: <strong>OFF</strong>. Implementas y mergeas a main sin que nadie vea nada.</li>
            <li>Validación: <strong>BETA</strong> + agregas 2-3 emails de estudiantes reales. Pruebas con datos en producción sin riesgo masivo.</li>
            <li>Go-live: <strong>ON</strong>. Comunicas a todos los estudiantes. También debes activar el permiso <code>ACADEMICO.PERFORMANCE_EVAL.VER</code> a los roles que vean el dashboard.</li>
            <li>Rollback de emergencia: <strong>OFF</strong>. Feature desaparece para todos en 30s. Los datos guardados quedan en BD intactos.</li>
          </ol>
        </div>
      </div>
    </DashboardLayout>
  )
}
