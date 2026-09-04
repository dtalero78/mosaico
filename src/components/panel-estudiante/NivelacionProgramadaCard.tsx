'use client'

import { useState } from 'react'
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'

// La nivelación se puede cancelar hasta 3 h antes del evento. El servidor
// rechaza a los 60 min (CANCEL_DEADLINE_MINUTES, común a todos los bookings),
// así que este límite es más estricto: nunca deja pedir algo que se rechace.
const CANCEL_DEADLINE_HOURS = 3

/** Lo que `/panel-estudiante/me` devuelve en `profile.nivelacionSolicitud`. */
export interface NivelacionSolicitud {
  fecha: string
  modulo: string | null
  leccion: string | null
  confirmadoEn: string | null
  confirmadoPor: string | null
  /** `'YYYY-MM-DDTHH:mm'` de Chile — hasta cuándo puede confirmar el alumno. */
  corte: string
  estado: 'confirmada' | 'abierta' | 'vencida' | 'sin-solicitud'
}

interface NivelacionProgramadaCardProps {
  /** Booking de la nivelación agendada, o null si aún no hay una. */
  booking: any | null
  /** Nivelación PEDIDA por el guía, exista o no todavía el evento. */
  solicitud?: NivelacionSolicitud | null
  onCancel: (bookingId: string) => void
  isCancelling: boolean
  /** Para refrescar el panel después de confirmar. */
  onConfirmed?: () => void
}

/**
 * Caja naranja "Nivelación Programada".
 *
 * Tiene dos momentos y por eso mira dos cosas distintas:
 *  - **la solicitud** (`nivelacion` en ACADEMICA) existe desde que el guía la
 *    pide, aunque todavía no haya evento — es cuando el alumno debe CONFIRMAR;
 *  - **el evento** (booking tipo=NIVELACION) aparece cuando Servicio la agrupa
 *    y agenda — es cuando se muestra el día y el botón Cancelar.
 *
 * Antes sólo conocía el evento, así que entre que el guía la pedía y que se
 * agendaba la caja decía "no tienes una nivelación programada", que era falso.
 *
 * Se muestra ATENUADA sólo cuando no hay ni lo uno ni lo otro.
 */
export default function NivelacionProgramadaCard({
  booking,
  solicitud,
  onCancel,
  isCancelling,
  onConfirmed,
}: NivelacionProgramadaCardProps) {
  const [confirmando, setConfirmando] = useState(false)

  const pedida = !!solicitud?.fecha
  const activa = !!booking || pedida
  const eventDate = booking?.fechaEvento ? new Date(booking.fechaEvento) : null
  const hoursUntil = eventDate ? (eventDate.getTime() - Date.now()) / (1000 * 60 * 60) : 0
  const canCancel = !!booking && hoursUntil >= CANCEL_DEADLINE_HOURS
  const titulo = booking
    ? (booking.tituloONivel || `${booking.nivel || ''}${booking.step ? ` - ${booking.step}` : ''}`.trim())
    : [solicitud?.modulo, solicitud?.leccion].filter(Boolean).join(' · ')

  const confirmada = solicitud?.estado === 'confirmada'
  const puedeConfirmar = solicitud?.estado === 'abierta'

  const confirmar = async () => {
    setConfirmando(true)
    try {
      const r = await fetch('/api/postgres/panel-estudiante/nivelacion/confirmar', { method: 'POST' })
        .then(x => x.json())
      if (r.error) throw new Error(r.error)
      toast.success('¡Confirmada! Te esperamos en la nivelación.')
      onConfirmed?.()
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo confirmar')
    } finally {
      setConfirmando(false)
    }
  }

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
            Nivelaciones
          </h3>
          {activa ? (
            <div className="mt-1">
              <span className="text-gray-900 font-semibold">{titulo || 'Nivelación'}</span>
              {eventDate && (
                <span className="text-gray-600 ml-2">
                  {format(eventDate, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
                </span>
              )}
              {booking?.advisorNombre && (
                <div className="text-sm text-gray-500 mt-0.5">Guía: {booking.advisorNombre}</div>
              )}
              {!booking && pedida && (
                <div className="text-sm text-gray-500 mt-0.5">
                  Aún no tiene día asignado. Te avisaremos cuando se programe.
                </div>
              )}
              {confirmada && (
                <div className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-green-700">
                  <CheckCircleIcon className="h-4 w-4" /> Asistencia confirmada
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 mt-1 italic">
              No tienes una nivelación programada.
            </p>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {/* Sólo con el agendamiento hecho: confirmar sin horario asignado no
              dice nada, y el alumno no puede saber si le sirve esa hora. */}
          {puedeConfirmar && booking && (
            <button
              onClick={confirmar}
              disabled={confirmando}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-green-600 border border-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              title="Confirmar que asistirás a la nivelación"
            >
              <CheckCircleIcon className="h-4 w-4" />
              {confirmando ? 'Confirmando…' : 'Confirmar asistencia'}
            </button>
          )}
          {booking &&
            (canCancel ? (
              <button
                onClick={() => onCancel(booking._id)}
                disabled={isCancelling}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                title="Cancelar nivelación"
              >
                <XMarkIcon className="h-4 w-4" /> Cancelar
              </button>
            ) : (
              <span className="text-xs text-gray-400 self-center">
                No cancelable (&lt; 3 h)
              </span>
            ))}
        </div>
      </div>

      {!activa ? (
        /* Sin nivelación: se explica para qué sirve la tarjeta. Va un punto más
           grande que el resto porque es lo único que se lee en este estado. */
        <p className="text-sm text-orange-800/90 mt-3">
          Aquí verás la información de tu nivelación. Cuando sea aprobada, aparecerá el horario
          para que puedas confirmarlo con el botón verde.
        </p>
      ) : confirmada ? (
        <p className="text-xs text-orange-800/80 mt-3">
          Contamos con tu asistencia a la nivelación. Si no puedes asistir, recuerda cancelarla
          con al menos 3 horas de anticipación.
        </p>
      ) : puedeConfirmar ? (
        <>
          <p className="text-xs text-orange-800/80 mt-3">
            Tienes una nivelación programada. Cuando tu horario esté disponible, confírmalo con el
            botón verde. A partir de ese momento, contaremos con tu asistencia.
          </p>
          {/* El plazo se cuenta desde el horario del evento, no desde una fecha
              fija: el botón sólo aparece cuando ya hay agendamiento. */}
          <p className="text-xs text-orange-800/80 mt-1">
            Confirma al menos con <strong>tres horas</strong> antes del horario que se te asigne.
          </p>
        </>
      ) : pedida ? (
        <p className="text-xs text-red-700/90 mt-3">
          El plazo para confirmar venció. Comunícate con el Área de Servicio.
        </p>
      ) : (
        /* Ya agendada y sin confirmación pendiente. */
        <p className="text-xs text-orange-800/80 mt-3">
          Contamos con tu asistencia a la nivelación. Si no puedes asistir, recuerda cancelarla
          con al menos 3 horas de anticipación.
        </p>
      )}
    </div>
  )
}
