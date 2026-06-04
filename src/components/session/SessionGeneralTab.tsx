'use client'

import { CalendarIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface CalendarioEvent {
  _id: string
  nombreEvento: string
  evento: 'SESSION' | 'CLUB' | 'WELCOME'
  dia: string
  advisor: string                          // ADVISORS._id (UUID) — no human-readable
  advisorNombreCompleto?: string | null    // viene del JOIN del endpoint
  advisorPrimerNombre?: string | null
  advisorPrimerApellido?: string | null
  tituloONivel: string
  observaciones?: string
  limiteUsuarios: number
  linkZoom?: string
}

interface SessionGeneralTabProps {
  evento: CalendarioEvent
  studentCount: number
}

export default function SessionGeneralTab({ evento, studentCount }: SessionGeneralTabProps) {
  // Preferir nombre completo del JOIN; fallback al UUID si no hay match en ADVISORS.
  const advisorDisplay =
    evento.advisorNombreCompleto?.trim() ||
    [evento.advisorPrimerNombre, evento.advisorPrimerApellido].filter(Boolean).join(' ').trim() ||
    evento.advisor ||
    'No asignado'

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
      {/* Información Básica */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          {evento.tituloONivel} - {evento.nombreEvento}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
            <CalendarIcon className="h-6 w-6 text-blue-600" />
            <div>
              <p className="text-sm text-blue-600 font-medium">Fecha</p>
              <p className="text-gray-900 font-semibold">
                {format(new Date(evento.dia), "EEEE, d 'de' MMMM", { locale: es })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-lg">
            <ClockIcon className="h-6 w-6 text-purple-600" />
            <div>
              <p className="text-sm text-purple-600 font-medium">Hora</p>
              <p className="text-gray-900 font-semibold">
                {format(new Date(evento.dia), 'HH:mm', { locale: es })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-lg">
            <UserGroupIcon className="h-6 w-6 text-emerald-600" />
            <div>
              <p className="text-sm text-emerald-600 font-medium">Estudiantes</p>
              <p className="text-gray-900 font-semibold">
                {studentCount} / {evento.limiteUsuarios}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Detalles Adicionales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Advisor
          </label>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-gray-900">{advisorDisplay}</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de Evento
          </label>
          <div className="p-3 bg-gray-50 rounded-lg">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              evento.evento === 'SESSION' ? 'bg-blue-100 text-blue-800' :
              evento.evento === 'CLUB' ? 'bg-purple-100 text-purple-800' :
              'bg-green-100 text-green-800'
            }`}>
              {evento.evento}
            </span>
          </div>
        </div>
      </div>

      {/* Observaciones */}
      {evento.observaciones && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Observaciones
          </label>
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-gray-800 whitespace-pre-wrap">{evento.observaciones}</p>
          </div>
        </div>
      )}

      {/* Link de Zoom */}
      {evento.linkZoom && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enlace de la Sesión
          </label>
          <a
            href={evento.linkZoom}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Ir a Zoom
          </a>
        </div>
      )}
    </div>
  )
}
