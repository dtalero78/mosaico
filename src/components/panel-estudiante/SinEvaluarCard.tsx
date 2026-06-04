'use client'

import { useState } from 'react'
import { StarIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { useEvaluacionesPendientes } from '@/hooks/use-evaluations'
import EvaluacionModal from './EvaluacionModal'

interface PendingItem {
  bookingId: string
  advisorNombre?: string | null
  tipo: string
  nivel: string
  step: string
  nombreEvento?: string | null
  fechaEvento?: string | null
}

/**
 * Tarjeta "Evaluaciones" V2 — lista SELECCIONABLE.
 *
 * Se renderiza SIEMPRE que el feature flag esté activo para el estudiante:
 *   - Con pendientes → estilo naranja con lista de sesiones por evaluar.
 *   - Sin pendientes → estilo neutro con mensaje "no hay eventos por evaluar".
 *
 * Si el flag está off para el estudiante → null (la tarjeta no existe).
 */
export default function SinEvaluarCard() {
  const { data, isLoading } = useEvaluacionesPendientes()
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)

  if (isLoading) return null
  if (!data?.featureEnabled) return null
  const rows: PendingItem[] = data?.rows ?? []
  const hasPending = rows.length > 0

  const selected = selectedBookingId
    ? rows.find(r => r.bookingId === selectedBookingId) ?? null
    : null

  // Estado vacío (sin pendientes) — paleta neutra verde-grisácea
  if (!hasPending) {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-gray-50 border-2 border-emerald-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-2">
          <div className="p-2 bg-emerald-200 rounded-lg flex-shrink-0">
            <CheckCircleIcon className="h-6 w-6 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-emerald-900">Valoración de Sesiones</h3>
            <p className="text-xs text-emerald-800 mt-0.5">
              Aquí verás las sesiones que tienes pendientes por valorar.
            </p>
          </div>
        </div>
        <p className="text-sm text-gray-500 text-center py-2">
          🎉 No tienes encuestas pendientes esta semana.
        </p>
      </div>
    )
  }

  // Con pendientes — paleta naranja original
  return (
    <>
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-300 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 bg-orange-200 rounded-lg flex-shrink-0"><StarIcon className="h-6 w-6 text-orange-700" /></div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-orange-900">
              Valoración pendiente · {rows.length} {rows.length === 1 ? 'sesión' : 'sesiones'}
            </h3>
            <p className="text-xs text-orange-800 mt-0.5">
              Selecciona una sesión y llena la encuesta.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {rows.map(r => (
            <li
              key={r.bookingId}
              className="flex items-start gap-2 bg-white/70 hover:bg-white rounded-lg p-2.5 border border-orange-200 transition-colors"
            >
              <div className="flex-1 min-w-0 text-xs text-orange-900">
                <div className="font-semibold truncate">
                  {r.tipo} {r.nombreEvento ? `· ${r.nombreEvento}` : `· ${r.step}`}
                </div>
                <div className="text-orange-700 mt-0.5 truncate">
                  {r.advisorNombre ? `${r.advisorNombre} · ` : ''}
                  {r.fechaEvento ? new Date(r.fechaEvento).toLocaleString('es-ES', {
                    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  }) : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBookingId(r.bookingId)}
                className="px-3 py-1.5 bg-orange-600 text-white text-xs font-semibold rounded-md hover:bg-orange-700 whitespace-nowrap flex-shrink-0"
              >
                Evaluar →
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && (
        <EvaluacionModal
          item={selected}
          onClose={() => setSelectedBookingId(null)}
          onSubmitted={() => setSelectedBookingId(null)}
        />
      )}
    </>
  )
}
