'use client'

import { useState, useEffect } from 'react'
import { OnHoldHistoryEntry } from '@/types'
import { api, ApiError } from '@/hooks/use-api'
import { usePermissions } from '@/hooks/usePermissions'
import { StudentPermission } from '@/types/permissions'
import UploadDocButton from './UploadDocButton'

interface StudentOnHoldProps {
  studentId: string
  peopleId: string | null
  numeroId: string
  estadoInactivo: boolean
  currentFechaOnHold?: string | null
  currentFechaFinOnHold?: string | null
  onHoldCount?: number
  onHoldHistory?: OnHoldHistoryEntry[]
}

export default function StudentOnHold({
  studentId,
  peopleId,
  numeroId,
  estadoInactivo: initialEstadoInactivo,
  currentFechaOnHold,
  currentFechaFinOnHold,
  onHoldCount = 0,
  onHoldHistory = []
}: StudentOnHoldProps) {
  const { hasPermission, isRole, isLoading: permLoading } = usePermissions()
  const hasFullAccess = isRole('SUPER_ADMIN') || isRole('ADMIN')
  const canOnHold = hasFullAccess || hasPermission(StudentPermission.ACTIVAR_HOLD)

  const [showModal, setShowModal] = useState(false)
  const [showOnHoldHistory, setShowOnHoldHistory] = useState(false)
  // A student is truly on hold only if estadoInactivo AND has active OnHold dates
  const hasActiveOnHold = initialEstadoInactivo && !!currentFechaOnHold
  const [isOnHold, setIsOnHold] = useState(hasActiveOnHold)
  const [fechaOnHold, setFechaOnHold] = useState('')
  const [fechaFinOnHold, setFechaFinOnHold] = useState('')
  const [motivoOnHold, setMotivoOnHold] = useState('')
  const [isTogglingOnHold, setIsTogglingOnHold] = useState(false)

  // Sincronizar con el prop inicial
  useEffect(() => {
    setIsOnHold(initialEstadoInactivo && !!currentFechaOnHold)
  }, [initialEstadoInactivo, currentFechaOnHold])

  // DEBUG: Log de props recibidos
  useEffect(() => {
    console.log('🔍 StudentOnHold - Props recibidos:', {
      studentId,
      peopleId,
      numeroId,
      estadoInactivo: initialEstadoInactivo,
      onHoldCount,
      onHoldHistory,
      onHoldHistoryLength: onHoldHistory?.length || 0
    })
  }, [studentId, peopleId, numeroId, initialEstadoInactivo, onHoldCount, onHoldHistory])

  const handleToggleOnHold = async () => {
    const newOnHoldStatus = !isOnHold

    // Si se está activando OnHold, mostrar el modal primero
    if (newOnHoldStatus) {
      setShowModal(true)
      return
    }

    // Si se está desactivando, confirmar directamente
    const confirmed = window.confirm(
      `⚠️ ¿Está seguro que desea DESACTIVAR el estado OnHold para este estudiante?\n\n` +
      `Esta acción:\n` +
      `  • Eliminará las fechas OnHold\n` +
      `  • REACTIVARÁ al estudiante en ACADEMICA`
    )

    if (!confirmed) return

    await executeOnHoldToggle(false, '', '')
  }

  const handleModalConfirm = async () => {
    // Validar fechas
    if (!fechaOnHold || !fechaFinOnHold) {
      alert('⚠️ Por favor seleccione ambas fechas (Inicio y Fin OnHold)')
      return
    }

    if (new Date(fechaFinOnHold) <= new Date(fechaOnHold)) {
      alert('⚠️ La Fecha Fin OnHold debe ser posterior a la Fecha Inicio OnHold')
      return
    }

    const diasOnHold = Math.ceil((new Date(fechaFinOnHold).getTime() - new Date(fechaOnHold).getTime()) / (1000 * 60 * 60 * 24))

    const confirmed = window.confirm(
      `⚠️ ¿Está seguro que desea ACTIVAR el estado OnHold?\n\n` +
      `Período OnHold:\n` +
      `  • Fecha Inicio: ${new Date(fechaOnHold).toLocaleDateString('es-ES')}\n` +
      `  • Fecha Fin: ${new Date(fechaFinOnHold).toLocaleDateString('es-ES')}\n` +
      `  • Duración: ${diasOnHold} días\n\n` +
      `Esta acción INACTIVARÁ al estudiante en ACADEMICA durante este período.`
    )

    if (!confirmed) return

    await executeOnHoldToggle(true, fechaOnHold, fechaFinOnHold, motivoOnHold)
    setShowModal(false)
  }

  const executeOnHoldToggle = async (setOnHold: boolean, inicio: string, fin: string, motivo?: string) => {
    setIsTogglingOnHold(true)

    try {
      const data = await api.post('/api/postgres/students/onhold', {
        studentId: peopleId || studentId,
        setOnHold,
        fechaOnHold: setOnHold ? inicio : null,
        fechaFinOnHold: setOnHold ? fin : null,
        motivo: motivo || undefined
      })

      setIsOnHold(setOnHold)
      alert(
        `✅ OnHold ${setOnHold ? 'activado' : 'desactivado'} exitosamente\n\n` +
        (data.message || 'Operación completada')
      )
      window.location.href = window.location.href
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : 'Error al comunicarse con el servidor'
      alert(`❌ ${msg}`)
    } finally {
      setIsTogglingOnHold(false)
    }
  }

  return (
    <>
      {/* Card Principal de OnHold - Estilo igual a Extensión de Vigencia */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <span className="text-2xl">⏸️</span>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">Estado OnHold</h4>
              <p className="text-sm text-gray-600">Pausar temporalmente al estudiante</p>
            </div>
          </div>
          {onHoldCount > 0 && (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300">
                📊 {onHoldCount} {onHoldCount === 1 ? 'período' : 'períodos'}
              </span>
              <button
                onClick={() => setShowOnHoldHistory(true)}
                className="text-xs text-blue-600 hover:text-blue-800 underline font-medium"
                title="Ver historial de OnHold"
              >
                Ver historial
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-gray-600 font-medium mb-1">📍 Estado Actual</p>
              <p className={`font-semibold ${isOnHold ? 'text-blue-600' : 'text-green-600'}`}>
                {isOnHold ? '⏸️ PAUSADO' : '✅ ACTIVO'}
              </p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-gray-600 font-medium mb-1">📊 Períodos OnHold</p>
              <p className="text-gray-900 font-semibold">
                {onHoldCount || 0} {onHoldCount === 1 ? 'período' : 'períodos'}
              </p>
            </div>
            <div className="bg-white/50 rounded-lg p-3">
              <p className="text-gray-600 font-medium mb-1">🔔 Último Cambio</p>
              <p className="text-gray-900 font-semibold">
                {onHoldHistory && onHoldHistory.length > 0
                  ? new Date(onHoldHistory[0].fechaActivacion).toLocaleDateString('es-ES')
                  : 'Sin historial'}
              </p>
            </div>
          </div>

          <button
            onClick={handleToggleOnHold}
            disabled={isTogglingOnHold || !canOnHold || permLoading}
            className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-2 ${
              isTogglingOnHold || !canOnHold || permLoading
                ? 'bg-gray-400 cursor-not-allowed text-white opacity-60'
                : isOnHold
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700'
            }`}
          >
            <span className="text-xl">{isOnHold ? '▶️' : '⏸️'}</span>
            {isOnHold ? 'Reactivar Estudiante' : 'Pausar Estudiante (OnHold)'}
          </button>
          {!permLoading && !canOnHold && (
            <p className="text-xs text-gray-400 text-center mt-1">
              Sin permiso para {isOnHold ? 'reactivar' : 'pausar'} estudiante
            </p>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                ⏸️ Activar OnHold para Estudiante
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    📅 Fecha Inicio OnHold <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={fechaOnHold}
                    onChange={(e) => setFechaOnHold(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Seleccione fecha de inicio"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    📅 Fecha Fin OnHold <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="date"
                    value={fechaFinOnHold}
                    onChange={(e) => setFechaFinOnHold(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Seleccione fecha de fin"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    📝 Motivo del OnHold
                  </label>
                  <textarea
                    value={motivoOnHold}
                    onChange={(e) => setMotivoOnHold(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Ej: Vacaciones, problemas personales, etc."
                    rows={3}
                  />
                </div>

                {fechaOnHold && fechaFinOnHold && (
                  <div className="p-3 bg-blue-50 rounded-md border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Duración OnHold:</strong>{' '}
                      {Math.ceil((new Date(fechaFinOnHold).getTime() - new Date(fechaOnHold).getTime()) / (1000 * 60 * 60 * 24))} días
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 mt-6">
                <UploadDocButton
                  peopleId={peopleId}
                  size="sm"
                  label="Agregar Doc."
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleModalConfirm}
                    disabled={!fechaOnHold || !fechaFinOnHold}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Activar OnHold
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Historial OnHold */}
      {showOnHoldHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                📊 Historial de OnHold
              </h3>
              <button
                onClick={() => setShowOnHoldHistory(false)}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              {onHoldHistory && onHoldHistory.length > 0 ? (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800">
                      <strong>Total de períodos OnHold:</strong> {onHoldCount} {onHoldCount === 1 ? 'vez' : 'veces'}
                    </p>
                  </div>

                  {onHoldHistory.map((entry, index) => {
                    const diasPausa = entry.fechaOnHold && entry.fechaFinOnHold
                      ? Math.ceil((new Date(entry.fechaFinOnHold).getTime() - new Date(entry.fechaOnHold).getTime()) / (1000 * 60 * 60 * 24))
                      : 0

                    return (
                      <div
                        key={index}
                        className="border-2 rounded-lg p-5 border-blue-300 bg-blue-50"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold text-gray-700">#{onHoldHistory.length - index}</span>
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-200 text-blue-800">
                              📊 Período OnHold
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Duración</p>
                            <p className="text-lg font-bold text-blue-600">{diasPausa} días</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 font-medium text-sm">📅 Inicio:</span>
                              <span className="text-gray-900 text-sm">
                                {new Date(entry.fechaOnHold).toLocaleDateString('es-ES', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 font-medium text-sm">📅 Fin:</span>
                              <span className="text-gray-900 text-sm">
                                {new Date(entry.fechaFinOnHold).toLocaleDateString('es-ES', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric'
                                })}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 font-medium text-sm">🕐 Activado:</span>
                              <span className="text-gray-900 text-sm">
                                {new Date(entry.fechaActivacion).toLocaleDateString('es-ES', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 font-medium text-sm">👤 Por:</span>
                              <span className="text-gray-900 text-sm">
                                {entry.activadoPor || 'Admin'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Mostrar motivo si existe */}
                        {entry.motivo && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-600 font-medium text-sm">📝 Motivo:</span>
                              <span className="text-gray-900 text-sm">{entry.motivo}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📊</div>
                  <p className="text-gray-500 text-lg">No hay historial de OnHold disponible</p>
                  <p className="text-gray-400 text-sm mt-2">Los períodos OnHold se registrarán aquí automáticamente</p>
                </div>
              )}
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-end">
              <button
                onClick={() => setShowOnHoldHistory(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
