'use client'

import { useState } from 'react'
import {
  CalendarDaysIcon,
  ClockIcon,
  CheckIcon,
  ArrowLeftIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { useAvailableEvents, useBookEvent, useDiasConEventos } from '@/hooks/use-panel-estudiante'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { etiquetaTipoEvento } from '@/lib/tipos-sesion'

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

  /** YYYY-MM-DD en la zona horaria LOCAL del alumno (no UTC: cambiaría el día). */
  const toLocalISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const today = new Date()
  const localToday = toLocalISO(today)

  // Fechas ofrecidas. Los TALLERES y las OLIMPIADAS se agendan mirando DOS semanas
  // —la en curso y la siguiente, de lunes a sábado— con los días ya pasados en
  // gris; el resto de agendamientos sigue con Hoy/Mañana.
  //
  // Son dos semanas porque un taller se crea a mano y casi siempre cae más allá
  // de la semana en curso: con una sola, el alumno no tenía cómo llegar a él.
  type OpcionFecha = { date: string; label: string; disabled?: boolean }
  const grupos: { titulo: string; dias: OpcionFecha[] }[] = []
  const esSemanal = initialTipo === 'CLUB' || initialTipo === 'OLIMPIADA'
  // Sólo los TALLERES llevan la leyenda de las dos clases de taller y los días
  // pintados: el modal se ensancha para que quepa el texto sin apretar la grilla.
  const esTaller = initialTipo === 'CLUB'

  if (esSemanal) {
    // Lunes de ESTA semana: getDay() es 0=domingo, así que el domingo cuenta como
    // el final de la semana en curso (retrocede 6 días, no 0).
    const dow = today.getDay()
    const lunes = new Date(today)
    lunes.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1))
    const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
    for (let semana = 0; semana < 2; semana++) {
      const dias: OpcionFecha[] = []
      for (let i = 0; i < DIAS.length; i++) {
        const d = new Date(lunes)
        d.setDate(lunes.getDate() + semana * 7 + i)
        const iso = toLocalISO(d)
        dias.push({
          date: iso,
          label: iso === localToday ? 'Hoy' : DIAS[i],
          disabled: iso < localToday, // comparación de strings YYYY-MM-DD: segura
        })
      }
      grupos.push({ titulo: semana === 0 ? 'Esta semana' : 'Próxima semana', dias })
    }
  } else {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    grupos.push({
      titulo: '',
      dias: [
        { date: localToday, label: 'Hoy' },
        { date: toLocalISO(tomorrow), label: 'Mañana' },
      ],
    })
  }

  // Días con TALLER programado en las dos semanas mostradas. Se consulta UNA vez
  // para todo el rango (no día por día) y sólo en Talleres: los demás tipos no
  // pintan nada. El servidor aplica el mismo alcance que la lista del día (curso
  // y salón del alumno), así que un día pintado siempre tiene algo que agendar.
  const rangoDesde = esTaller && grupos.length ? grupos[0].dias[0].date : ''
  const rangoHasta = esTaller && grupos.length ? grupos[grupos.length - 1].dias.slice(-1)[0].date : ''
  const { data: diasData } = useDiasConEventos(rangoDesde, rangoHasta, 'CLUB')
  const diasConTaller = new Set<string>(diasData?.dias || [])

  /**
   * Cómo se pinta un día con taller. La regla es por DÍA DE LA SEMANA, que es
   * como se distinguen las dos clases de taller: el de APODERADOS cae en
   * miércoles (naranja) y el de ESTUDIANTES en viernes (azul). Un taller en
   * otro día se marca en verde, el color del Taller en el resto del panel, para
   * no esconderlo.
   */
  type EstiloTaller = { caja: string; icono: string; texto: string; etiqueta: string }
  const estiloTaller = (date: string): EstiloTaller | null => {
    if (!esTaller || !diasConTaller.has(date)) return null
    const dow = new Date(date + 'T12:00:00').getDay()   // 3 = miércoles, 5 = viernes
    if (dow === 3) return { caja: 'bg-orange-100 border-orange-400 ring-1 ring-orange-300 hover:bg-orange-200 hover:border-orange-500', icono: 'text-orange-600', texto: 'text-orange-700', etiqueta: 'Taller apoderados' }
    if (dow === 5) return { caja: 'bg-blue-100 border-blue-400 ring-1 ring-blue-300 hover:bg-blue-200 hover:border-blue-500', icono: 'text-blue-600', texto: 'text-blue-700', etiqueta: 'Taller estudiantes' }
    return { caja: 'bg-green-50 border-green-400 ring-1 ring-green-200 hover:bg-green-100 hover:border-green-500', icono: 'text-green-600', texto: 'text-green-700', etiqueta: 'Taller programado' }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className={`bg-white rounded-t-2xl sm:rounded-2xl w-full ${esTaller ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[85vh] overflow-y-auto`}>
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
            <div className="space-y-4">
              {/* Leyenda de los Talleres: qué dos clases hay y con qué color se
                  marca el día en el que se programó alguno. */}
              {esTaller && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900 mb-2">Recuerde que hay dos clases de Talleres:</p>
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-orange-400 ring-1 ring-orange-500" aria-hidden="true" />
                      <span>
                        <span className="font-semibold text-orange-800">APODERADOS</span>: se realizan una vez al mes y generalmente son los miércoles.
                        En el calendario el día se marca en <span className="font-semibold text-orange-800">color naranja</span> si se ha programado alguno.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-blue-400 ring-1 ring-blue-500" aria-hidden="true" />
                      <span>
                        <span className="font-semibold text-blue-800">ESTUDIANTES</span>: se programan usualmente los viernes.
                        En el calendario el día se marca en <span className="font-semibold text-blue-800">color azul</span> si se ha programado alguno.
                      </span>
                    </li>
                  </ul>
                </div>
              )}
              {grupos.map(({ titulo, dias }) => (
                <div key={titulo || 'unico'}>
                  {titulo && (
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      {titulo}
                    </div>
                  )}
                  {/* En Talleres el modal es más ancho: la semana cabe en tres
                      columnas (lun·mar·mié / jue·vie·sáb). */}
                  <div className={`grid grid-cols-2 gap-2 ${esTaller ? 'sm:grid-cols-3' : ''}`}>
              {dias.map(({ date, label, disabled }) => {
                const d = new Date(date + 'T12:00:00')
                const esHoy = label === 'Hoy'
                // El color del taller manda sobre el resalte de "Hoy": es la
                // información que el alumno vino a buscar.
                const taller = disabled ? null : estiloTaller(date)
                return (
                  <button
                    key={date}
                    onClick={() => !disabled && handleDateSelect(date)}
                    disabled={disabled}
                    title={disabled ? 'Este día ya pasó' : taller ? `${taller.etiqueta} programado` : undefined}
                    className={
                      disabled
                        ? 'flex items-center gap-2 p-4 bg-gray-50 rounded-lg border border-gray-200 text-left opacity-40 cursor-not-allowed'
                        : `flex items-center gap-2 p-4 rounded-lg border transition-colors text-left ${
                            taller ? taller.caja
                            : esHoy ? 'bg-primary-50 border-primary-300 hover:bg-primary-100 hover:border-primary-400'
                            : 'bg-gray-50 border-gray-200 hover:bg-primary-50 hover:border-primary-300'
                          }`
                    }
                  >
                    <CalendarDaysIcon className={`h-5 w-5 ${disabled ? 'text-gray-300' : taller ? taller.icono : esHoy ? 'text-primary-600' : 'text-gray-400'}`} />
                    <div>
                      <div className={`text-sm font-bold ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>{label}</div>
                      <div className="text-xs text-gray-500">
                        {format(d, "EEEE d 'de' MMMM", { locale: es })}
                      </div>
                      {taller && (
                        <div className={`text-[11px] font-semibold ${taller.texto}`}>{taller.etiqueta}</div>
                      )}
                    </div>
                  </button>
                )
              })}
                  </div>
                </div>
              ))}
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
                                {format(eventDate, 'HH:mm')} - {evt.esESS ? 'ESS' : (etiquetaTipoEvento(evt.tipo || evt.evento) || '-')}
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
                  {etiquetaTipoEvento(selectedEvent.tipo)} - {selectedEvent.nivel}
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
