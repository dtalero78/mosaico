'use client'

import { useState } from 'react'
import {
  CalendarDaysIcon,
  ClockIcon,
  CheckIcon,
  ArrowLeftIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { useAvailableEvents, useBookEvent } from '@/hooks/use-panel-estudiante'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface BookingFlowProps {
  onClose: () => void
  initialTipo?: string
}

type Step = 'date' | 'type' | 'events' | 'confirm'

export default function BookingFlow({ onClose, initialTipo }: BookingFlowProps) {
  const [step, setStep] = useState<Step>('date')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTipo, setSelectedTipo] = useState<string | undefined>(initialTipo)
  const [selectedEvent, setSelectedEvent] = useState<any>(null)

  const { data, isLoading } = useAvailableEvents(selectedDate, selectedTipo)
  const bookMutation = useBookEvent()

  const events = data?.events || []

  const handleDateSelect = (date: string) => {
    setSelectedDate(date)
    // Skip type step when tipo was pre-selected
    if (initialTipo) {
      setStep('events')
    } else {
      setStep('type')
    }
  }

  const handleTipoSelect = (tipo?: string) => {
    setSelectedTipo(tipo)
    setStep('events')
  }

  const handleEventSelect = (evt: any) => {
    setSelectedEvent(evt)
    setStep('confirm')
  }

  const handleConfirm = () => {
    if (!selectedEvent) return
    bookMutation.mutate(selectedEvent._id, {
      onSuccess: () => onClose(),
    })
  }

  const handleBack = () => {
    if (step === 'type') { setStep('date'); setSelectedTipo(undefined) }
    else if (step === 'events') {
      if (initialTipo) { setStep('date'); setSelectedDate('') }
      else { setStep('type'); setSelectedEvent(null) }
    }
    else if (step === 'confirm') { setStep('events') }
  }

  // Only allow Today and Tomorrow (using local timezone)
  const dates: { date: string; label: string }[] = []
  const today = new Date()
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  dates.push({
    date: localToday,
    label: 'Hoy',
  })
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const localTomorrow = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  dates.push({
    date: localTomorrow,
    label: 'Mañana',
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center gap-3 rounded-t-2xl">
          {step !== 'date' && (
            <button onClick={handleBack} className="p-1 hover:bg-gray-100 rounded-lg">
              <ArrowLeftIcon className="h-5 w-5 text-gray-600" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-900 flex-1">
            {step === 'date' && 'Selecciona una fecha'}
            {step === 'type' && 'Tipo de clase'}
            {step === 'events' && 'Horarios disponibles'}
            {step === 'confirm' && 'Confirmar agendamiento'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          {/* Step 1: Date Selection */}
          {step === 'date' && (
            <div className="grid grid-cols-2 gap-2">
              {dates.map(({ date, label }) => {
                const d = new Date(date + 'T12:00:00')
                return (
                  <button
                    key={date}
                    onClick={() => handleDateSelect(date)}
                    className="flex items-center gap-2 p-4 bg-gray-50 rounded-lg hover:bg-primary-50 hover:border-primary-300 border border-gray-200 transition-colors text-left"
                  >
                    <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <div className="text-sm font-bold text-gray-900">{label}</div>
                      <div className="text-xs text-gray-500">
                        {format(d, "EEEE d 'de' MMMM", { locale: es })}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Step 2: Type Selection */}
          {step === 'type' && (
            <div className="space-y-2">
              {[
                { value: 'SESSION', label: 'Sesion', desc: 'Clase regular con advisor', color: 'border-l-blue-500' },
                { value: 'CLUB', label: 'Taller', desc: 'Training session grupal', color: 'border-l-green-500' },
              ].map((tipo) => (
                <button
                  key={tipo.value}
                  onClick={() => handleTipoSelect(tipo.value)}
                  className={`w-full p-4 bg-gray-50 rounded-lg border-l-4 ${tipo.color} hover:bg-gray-100 transition-colors text-left`}
                >
                  <div className="font-medium text-gray-900">{tipo.label}</div>
                  <div className="text-sm text-gray-500">{tipo.desc}</div>
                </button>
              ))}
              <button
                onClick={() => handleTipoSelect(undefined)}
                className="w-full p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors text-left"
              >
                <div className="font-medium text-gray-900">Todos</div>
                <div className="text-sm text-gray-500">Ver todas las clases disponibles</div>
              </button>
            </div>
          )}

          {/* Step 3: Event Selection */}
          {step === 'events' && (
            <div>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
              ) : events.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <CalendarDaysIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm">No hay clases disponibles para esta fecha</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((evt: any) => {
                    const eventDate = new Date(evt.dia)
                    const isDisabled = evt.cupoLleno || evt.yaInscrito || evt.tiempoInsuficiente
                    const tipoColor = evt.esESS
                      ? 'border-l-orange-400'
                      : evt.tipo === 'SESSION'
                      ? 'border-l-blue-500'
                      : evt.tipo === 'CLUB'
                      ? 'border-l-green-500'
                      : 'border-l-purple-500'

                    return (
                      <button
                        type="button"
                        key={evt._id}
                        onClick={() => !isDisabled && handleEventSelect(evt)}
                        disabled={isDisabled}
                        className={`w-full p-3 bg-gray-50 rounded-lg border-l-4 ${tipoColor} text-left transition-colors ${
                          isDisabled
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <ClockIcon className="h-4 w-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-900">
                                {format(eventDate, 'HH:mm')} - {evt.esESS ? 'ESS' : (evt.tipo || evt.evento || '-')}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {(() => {
                                if (evt.esESS) return 'English Speaking Session'
                                const stepStr = evt.step || evt.nombreEvento || '-'
                                const stepNum = stepStr.match(/Step\s*(\d+)/i)?.[1]
                                const isJump = stepNum && parseInt(stepNum) % 5 === 0
                                return `${evt.nivel || evt.tituloONivel || '-'} - ${stepStr}${isJump ? ' Jump' : ''}`
                              })()}
                              {evt.advisorNombreCompleto && ` | ${evt.advisorNombreCompleto}`}
                            </div>
                          </div>
                          <div className="text-right">
                            {evt.yaInscrito ? (
                              <span className="text-xs font-medium text-blue-600">Ya inscrito</span>
                            ) : evt.cupoLleno ? (
                              <span className="text-xs font-medium text-red-600">Lleno</span>
                            ) : evt.tiempoInsuficiente ? (
                              <span className="text-xs font-medium text-gray-400">Próximamente</span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 'confirm' && selectedEvent && (
            <div className="space-y-4">
              <div className="bg-primary-50 rounded-lg p-4 border border-primary-200">
                <div className="text-sm font-semibold text-primary-900 mb-2">
                  {selectedEvent.tipo} - {selectedEvent.nivel}
                </div>
                <div className="space-y-1 text-sm text-primary-700">
                  <div className="flex items-center gap-2">
                    <CalendarDaysIcon className="h-4 w-4" />
                    {format(new Date(selectedEvent.dia), "EEEE d 'de' MMMM, HH:mm", { locale: es })}
                  </div>
                  {selectedEvent.advisorNombreCompleto && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4" />
                      {selectedEvent.advisorNombreCompleto}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={bookMutation.isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {bookMutation.isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                ) : (
                  <>
                    <CheckIcon className="h-5 w-5" />
                    Confirmar Agendamiento
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
