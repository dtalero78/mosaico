'use client'

import { XMarkIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// La nivelación se puede cancelar hasta 24 h antes del evento.
const CANCEL_DEADLINE_HOURS = 24

interface NivelacionProgramadaCardProps {
  /** Booking de la nivelación agendada, o null si aún no hay una. */
  booking: any | null
  onCancel: (bookingId: string) => void
  isCancelling: boolean
}

/**
 * Caja naranja "Nivelación Programada".
 * Siempre visible; se muestra ATENUADA (deshabilitada) mientras no exista una
 * nivelación aprobada y agendada. Cuando el admin aprueba la nivelación y la
 * agenda (booking tipo=NIVELACION), la caja se habilita mostrando el evento y
 * el botón Cancelar (misma función que el cancel de los eventos programados,
 * con deadline de 24 h).
 */
export default function NivelacionProgramadaCard({
  booking,
  onCancel,
  isCancelling,
}: NivelacionProgramadaCardProps) {
  const activa = !!booking
  const eventDate = booking?.fechaEvento ? new Date(booking.fechaEvento) : null
  const hoursUntil = eventDate ? (eventDate.getTime() - Date.now()) / (1000 * 60 * 60) : 0
  const canCancel = activa && hoursUntil >= CANCEL_DEADLINE_HOURS
  const titulo = booking
    ? (booking.tituloONivel || `${booking.nivel || ''}${booking.step ? ` - ${booking.step}` : ''}`.trim())
    : ''

  return (
    <div
      className={`rounded-xl border p-5 ${
        activa
          ? 'bg-orange-50 border-orange-300'
          : 'bg-orange-50/40 border-orange-200 opacity-70'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-orange-700 uppercase tracking-wide">
            Nivelación Programada:
          </h3>
          {activa ? (
            <div className="mt-1">
              <span className="text-gray-900 font-semibold">{titulo || 'Nivelación'}</span>
              {eventDate && (
                <span className="text-gray-600 ml-2">
                  {format(eventDate, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
                </span>
              )}
              {booking.advisorNombre && (
                <div className="text-sm text-gray-500 mt-0.5">Guía: {booking.advisorNombre}</div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 mt-1 italic">
              No tienes una nivelación programada.
            </p>
          )}
        </div>

        {activa &&
          (canCancel ? (
            <button
              onClick={() => onCancel(booking._id)}
              disabled={isCancelling}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              title="Cancelar nivelación"
            >
              <XMarkIcon className="h-4 w-4" /> Cancelar
            </button>
          ) : (
            <span className="flex-shrink-0 text-xs text-gray-400 self-center">
              No cancelable (&lt; 24 h)
            </span>
          ))}
      </div>

      <p className="text-xs text-orange-800/80 mt-3">
        Se cuenta con tu asistencia a la nivelación, en caso de no poder asistir puedes cancelarla
        hasta 24 Hrs antes del Evento.
      </p>
    </div>
  )
}
