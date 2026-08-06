'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface MyEventsSectionProps {
  events: any[]
  isLoading: boolean
  // Props conservadas por compatibilidad con el padre; la cancelación de
  // sesiones/talleres desde el panel del estudiante está DESHABILITADA para
  // todos los cursos (se quitó la columna "Cancelar").
  onCancel?: (bookingId: string) => void
  isCancelling?: boolean
}

export default function MyEventsSection({
  events,
  isLoading,
}: MyEventsSectionProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="h-5 bg-gray-200 rounded w-44 mb-4 animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg mb-2 animate-pulse" />
        ))}
      </div>
    )
  }

  const upcomingEvents = events || []

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Agenda Semanal Eventos:
      </h3>
      {upcomingEvents.length === 0 ? (
        <p className="text-gray-400 text-sm py-4">No tienes eventos programados</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Evento</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-500 uppercase">Guía</th>
              </tr>
            </thead>
            <tbody>
              {upcomingEvents.map((evt: any) => {
                const eventDate = new Date(evt.fechaEvento)

                return (
                  <tr key={evt._id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-2 text-gray-700 whitespace-nowrap">
                      {format(eventDate, "d MMM, HH:mm", { locale: es })}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="text-gray-900 font-medium">
                        {evt.tipo || evt.tipoEvento}
                      </span>
                      <span className="text-gray-500 ml-1">
                        {evt.nivel} - {evt.step}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-600">
                      {evt.advisorNombre || '---'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
