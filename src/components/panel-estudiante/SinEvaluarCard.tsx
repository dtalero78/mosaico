'use client'

import { useState } from 'react'
import { StarIcon } from '@heroicons/react/24/solid'
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
 * Tarjeta "⭐ Sin Evaluar" V2 — lista SELECCIONABLE (no cadena).
 *
 * Cada pendiente es una fila con su botón "Evaluar"; el usuario elige cuál
 * abrir. Al enviar una evaluación, esa pendiente desaparece y la lista se
 * refresca. Se renderiza sólo si el feature flag está activo PARA el
 * estudiante (defensa server-side: `featureEnabled:false` → no data → null).
 *
 * Se muestra SIEMPRE que haya pendientes. No bloquea el agendamiento — el
 * panel-estudiante lo hace mediante un soft-prompt independiente.
 */
export default function SinEvaluarCard() {
  const { data, isLoading } = useEvaluacionesPendientes()
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)

  if (isLoading) return null
  if (!data?.featureEnabled) return null
  const rows: PendingItem[] = data?.rows ?? []
  if (rows.length === 0) return null

  const selected = selectedBookingId
    ? rows.find(r => r.bookingId === selectedBookingId) ?? null
    : null

  return (
    <>
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-300 rounded-2xl p-5 shadow-sm h-full flex flex-col">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 bg-orange-200 rounded-lg flex-shrink-0"><StarIcon className="h-6 w-6 text-orange-700" /></div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-orange-900">
              Sin Evaluar · {rows.length} {rows.length === 1 ? 'sesión' : 'sesiones'}
            </h3>
            <p className="text-xs text-orange-800 mt-0.5">
              Selecciona una sesión y comparte tu feedback.
            </p>
          </div>
        </div>

        <ul className="space-y-2 flex-1 overflow-y-auto">
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
