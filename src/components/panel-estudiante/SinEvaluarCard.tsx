'use client'

import { useState } from 'react'
import { StarIcon } from '@heroicons/react/24/solid'
import { useEvaluacionesPendientes } from '@/hooks/use-evaluations'
import EvaluacionModal from './EvaluacionModal'

/**
 * Tarjeta "⭐ Sin Evaluar" en /panel-estudiante. Se renderiza SOLO si el
 * feature flag está activo PARA el estudiante (defensa server-side ya da
 * `featureEnabled:false` en ese caso → no llega data → no se muestra).
 *
 * Al hacer click → abre EvaluacionModal en modo cadena con todas las
 * pendientes. Cuando termina → invalida el query → la tarjeta desaparece.
 */
export default function SinEvaluarCard() {
  const { data, isLoading } = useEvaluacionesPendientes()
  const [open, setOpen] = useState(false)

  if (isLoading) return null
  if (!data?.featureEnabled) return null
  const rows = data?.rows ?? []
  if (rows.length === 0) return null

  return (
    <>
      <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-300 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-orange-200 rounded-lg"><StarIcon className="h-6 w-6 text-orange-700" /></div>
            <div>
              <h3 className="text-lg font-bold text-orange-900">
                Sin Evaluar · {rows.length} {rows.length === 1 ? 'sesión' : 'sesiones'}
              </h3>
              <p className="text-sm text-orange-800 mt-0.5">
                Tu feedback ayuda a mejorar las clases. Evalúa para poder agendar la próxima.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-orange-700">
                {rows.slice(0, 3).map((r: any) => (
                  <li key={r.bookingId}>
                    • <strong>{r.tipo}</strong> {r.nombreEvento || r.step} ·{' '}
                    {r.fechaEvento ? new Date(r.fechaEvento).toLocaleDateString('es-ES') : ''}
                  </li>
                ))}
                {rows.length > 3 && <li className="italic text-orange-600">… y {rows.length - 3} más</li>}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-5 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 shadow-sm whitespace-nowrap">
            Evaluar ahora →
          </button>
        </div>
      </div>

      {open && (
        <EvaluacionModal
          items={rows}
          onClose={() => setOpen(false)}
          onAllDone={() => setOpen(false)}
        />
      )}
    </>
  )
}
