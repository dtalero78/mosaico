'use client'

import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'

interface ProgressReportProps {
  data: any
  isLoading: boolean
}

export default function ProgressReport({ data, isLoading }: ProgressReportProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  const report = data?.report
  if (!report) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <p className="text-gray-400 text-sm">No se pudo cargar el progreso</p>
      </div>
    )
  }

  const { progress, stats } = report
  const steps = progress?.progressByStep || []

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Progreso - {progress?.nivelActual}
          </h3>
          <span className="text-lg font-bold text-primary-600">
            {progress?.porcentajeProgreso || 0}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-primary-600 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progress?.porcentajeProgreso || 0}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{progress?.stepsCompletados || 0} de {progress?.totalSteps || 0} steps</span>
          <span>{stats?.porcentajeAsistencia || 0}% asistencia</span>
        </div>
      </div>

      {/* Steps Detail */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Detalle por Step
        </h3>
        <div className="space-y-2">
          {steps.map((s: any) => (
            <div
              key={s.step}
              className={`flex items-start gap-3 p-3 rounded-lg ${
                s.completado ? 'bg-green-50' : 'bg-gray-50'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {s.completado ? (
                  <CheckCircleIcon className="h-5 w-5 text-green-600" />
                ) : s.hasOverride && s.overrideCompletado === false ? (
                  <XCircleIcon className="h-5 w-5 text-red-500" />
                ) : (
                  <ArrowPathIcon className="h-5 w-5 text-gray-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {(() => {
                      const match = s.step?.match(/^(.+?)\s*-\s*Step\s*\d+/i)
                      return match ? match[1].trim() : s.step
                    })()}
                  </span>
                  {s.esJump && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      JUMP
                    </span>
                  )}
                </div>
                {!s.completado && s.mensaje && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.complementariaEligible && s.mensaje.includes('complementaria')
                      ? (() => {
                          const parts = s.mensaje.split('actividad complementaria')
                          return (
                            <>
                              {parts[0]}
                              <a
                                href={`/panel-estudiante/actividades-complementarias?step=${encodeURIComponent(s.step)}&nivel=${encodeURIComponent(progress?.nivelActual || '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-blue-600 hover:text-blue-800 underline"
                              >
                                actividad complementaria
                              </a>
                              {parts[1]}
                            </>
                          )
                        })()
                      : s.mensaje}
                  </p>
                )}
                {!s.esJump && (
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span>Sesiones: {s.sesionesExitosas}/2</span>
                    <span>
                      Taller:{' '}
                      {s.clubNombres && s.clubNombres.length > 0
                        ? s.clubNombres.join(', ')
                        : '0/1'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
