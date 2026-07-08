'use client'

import { useState, useEffect } from 'react'
import { Student } from '@/types'

interface StudentProgressProps {
  student: Student
}

interface OverrideHistoryEntry {
  fecha: string
  accion: 'MARCADO_COMPLETO' | 'MARCADO_INCOMPLETO' | 'OVERRIDE_QUITADO'
  isCompletedBefore: boolean | null
  isCompletedAfter: boolean | null
  motivo: string
  realizadoPor: string
  realizadoPorNombre?: string | null
}

interface StepProgress {
  step: string
  esJump: boolean
  totalClases: number
  sesiones: number
  sesionesExitosas: number
  clubs: number
  clubsExitosos: number
  clubNombres?: string[]
  noAprobo: boolean
  completado: boolean
  mensaje: string | null
  hasOverride: boolean
  overrideCompletado: boolean | null
  notaOverrideHistory?: OverrideHistoryEntry[]
  complementariaEligible?: boolean
}

interface ProgressData {
  student: {
    nombre: string
    nivel: string
    step: string
    nivelParalelo?: string
    stepParalelo?: string
  }
  progress: {
    nivelActual: string
    totalSteps: number
    stepsCompletados: number
    porcentajeProgreso: number
    progressByStep: StepProgress[]
  }
  stats: {
    totalClases: number
    totalAsistencias: number
    totalAusencias: number
    totalPendientes: number
    porcentajeAsistencia: number
  }
  byTipo: Array<{ tipo: string; totalClases: number; asistencias: number }>
}

export default function StudentProgress({ student }: StudentProgressProps) {
  const [progressData, setProgressData] = useState<ProgressData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Modal con timeline del historial de override (Opción C)
  const [historyModal, setHistoryModal] = useState<{ step: string; entries: OverrideHistoryEntry[] } | null>(null)

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }
  const accionLabel = (a: OverrideHistoryEntry['accion']) =>
    a === 'MARCADO_COMPLETO'   ? 'Marcado completo' :
    a === 'MARCADO_INCOMPLETO' ? 'Marcado incompleto' :
                                 'Override quitado'
  const accionColor = (a: OverrideHistoryEntry['accion']) =>
    a === 'MARCADO_COMPLETO'   ? 'bg-purple-100 text-purple-700' :
    a === 'MARCADO_INCOMPLETO' ? 'bg-orange-100 text-orange-700' :
                                 'bg-gray-100 text-gray-700'

  useEffect(() => {
    loadProgressData()
  }, [student._id])

  const loadProgressData = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/postgres/students/${student._id}/progress`)

      if (!response.ok) {
        throw new Error('Error al cargar el diagnóstico académico')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Error al cargar el diagnóstico académico')
      }

      setProgressData(result)

    } catch (err) {
      console.error('Error cargando diagnóstico:', err)
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-2">
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600">Cargando diagnóstico académico...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error al cargar el diagnóstico</h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
              <button
                onClick={loadProgressData}
                className="mt-3 btn-secondary text-sm"
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!progressData) {
    return (
      <div className="card">
        <p className="text-gray-500 text-center py-8">No hay datos disponibles</p>
      </div>
    )
  }

  const { progress, stats, byTipo } = progressData

  return (
    <div className="space-y-4">
      {/* Resumen general */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-600">{stats.totalClases}</p>
          <p className="text-xs text-gray-500 mt-1">Total Clases</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{stats.totalAsistencias}</p>
          <p className="text-xs text-gray-500 mt-1">Asistencias</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-600">{stats.totalAusencias}</p>
          <p className="text-xs text-gray-500 mt-1">Ausencias</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-purple-600">{stats.porcentajeAsistencia}%</p>
          <p className="text-xs text-gray-500 mt-1">% Asistencia</p>
        </div>
      </div>

      {/* Progreso del nivel */}
      {progress.nivelActual && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Progreso en {progress.nivelActual}
            </h3>
            <span className="text-sm text-gray-500">
              {progress.stepsCompletados} / {progress.totalSteps} steps completados
            </span>
          </div>

          {/* Barra de progreso */}
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress.porcentajeProgreso}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 text-right mb-4">{progress.porcentajeProgreso}% completado</p>

          {/* Tabla de steps */}
          {progress.progressByStep.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Step</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Sesiones</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Talleres</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.progressByStep.map((s) => (
                    <tr key={s.step} className={`border-b border-gray-100 ${s.esJump ? 'bg-orange-50' : ''}`}>
                      <td className="py-2 px-3 font-medium text-gray-900">
                        {s.esJump ? (
                          <span className="flex items-center gap-1">
                            <span className="text-orange-600">Jump</span>
                            <span className="text-gray-400 text-xs">({s.step})</span>
                          </span>
                        ) : (
                          s.step
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-gray-600">
                        {s.esJump ? (
                          <span>{s.totalClases > 0 ? '1' : '0'} / 1</span>
                        ) : (
                          <span className={s.sesionesExitosas >= 2 ? 'text-green-600 font-medium' : ''}>
                            {s.sesionesExitosas} / 2
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-gray-600">
                        {s.esJump ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={s.clubsExitosos >= 1 ? 'text-green-600 font-medium' : ''}>
                              {s.clubsExitosos} / 1
                            </span>
                            {s.clubNombres && s.clubNombres.length > 0 && (
                              <span className="text-xs text-gray-400">
                                {s.clubNombres.join(', ')}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          {s.completado ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Completado
                            </span>
                          ) : s.noAprobo ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              No aprobó
                            </span>
                          ) : s.totalClases > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              En progreso
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              Pendiente
                            </span>
                          )}
                          {s.hasOverride && (() => {
                            const history = s.notaOverrideHistory ?? []
                            const last = history[history.length - 1]
                            const lastInfo = last
                              ? `${last.motivo}\n— ${last.realizadoPorNombre || last.realizadoPor} · ${fmtDate(last.fecha)}\n(Clic para ver historial completo: ${history.length} ${history.length === 1 ? 'cambio' : 'cambios'})`
                              : 'Sin historial registrado (override creado antes del registro auditable). Clic para ver detalle.'
                            return (
                              <button
                                type="button"
                                onClick={() => setHistoryModal({ step: s.step, entries: history })}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-2 hover:ring-offset-1 ${
                                  s.overrideCompletado === true
                                    ? 'bg-purple-100 text-purple-700 hover:ring-purple-300'
                                    : 'bg-orange-100 text-orange-700 hover:ring-orange-300'
                                }`}
                                title={lastInfo}
                              >
                                ✎ {s.overrideCompletado === true ? 'Override ✓' : 'Override ✗'}
                              </button>
                            )
                          })()}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500 italic">
                        {s.mensaje || (s.completado ? '' : '')}
                        {s.complementariaEligible && (
                          <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 not-italic">
                            Elegible Complementaria
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Clases por tipo */}
      {byTipo.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Clases por Tipo</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {byTipo.map((t) => (
              <div key={t.tipo} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase">{t.tipo}</p>
                <p className="text-lg font-bold text-gray-900">{t.totalClases}</p>
                <p className="text-xs text-green-600">{t.asistencias} asistencias</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botón para recargar */}
      <div className="flex justify-end">
        <button
          onClick={loadProgressData}
          className="btn-secondary text-sm"
          disabled={isLoading}
        >
          <svg className="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* Modal — historial auditable del override (Opción C) */}
      {historyModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-900/60" onClick={() => setHistoryModal(null)} />
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Historial del override</h3>
                  <p className="text-sm text-gray-500">{historyModal.step} — {historyModal.entries.length} {historyModal.entries.length === 1 ? 'cambio registrado' : 'cambios registrados'}</p>
                </div>
                <button type="button" onClick={() => setHistoryModal(null)} className="text-gray-400 hover:text-gray-600" title="Cerrar">✕</button>
              </div>

              {historyModal.entries.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  Este override está activo pero <strong>no tiene historial registrado</strong>. Esto significa que fue creado antes de que se implementara el registro auditable (mayo 2026). Cualquier cambio futuro sí quedará registrado aquí.
                </div>
              ) : (
                <ul className="space-y-3">
                  {[...historyModal.entries].reverse().map((e, idx) => (
                    <li key={idx} className="border-l-4 border-gray-200 pl-3 py-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${accionColor(e.accion)}`}>{accionLabel(e.accion)}</span>
                        <span className="text-xs text-gray-500">{fmtDate(e.fecha)}</span>
                        <span className="text-[10px] text-gray-400">
                          {e.isCompletedBefore === null ? '∅' : e.isCompletedBefore ? '✓' : '✗'}
                          {' → '}
                          {e.isCompletedAfter === null ? '∅' : e.isCompletedAfter ? '✓' : '✗'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{e.motivo}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Por: {e.realizadoPorNombre || e.realizadoPor || '—'}
                        {e.realizadoPorNombre && e.realizadoPor && <span className="text-gray-400"> · {e.realizadoPor}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => setHistoryModal(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
