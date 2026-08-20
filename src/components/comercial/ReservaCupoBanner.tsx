'use client'

import { useEffect, useState } from 'react'
import { ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

/**
 * Cuenta atrás de la RESERVA del cupo.
 *
 * Al crear el contrato el asiento queda reservado un rato mientras el comercial
 * cierra la gestión. Si marca "Contrato Para Aprobación" dentro del plazo, el cupo
 * pasa a confirmado; si no, la reserva **caduca sola** — la ocupación se calcula al
 * leer, así que basta con que la fecha quede atrás.
 *
 * El banner existe para que el plazo se VEA: sin él, el comercial no tiene forma de
 * saber que el asiento que está gestionando tiene fecha de vencimiento.
 */
export default function ReservaCupoBanner({
  beneficiarios,
  yaListo,
}: {
  beneficiarios: any[]
  yaListo: boolean
}) {
  // Un tick por segundo mientras el banner está en pantalla.
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (yaListo) return null

  // Se muestra el plazo del PRIMERO que vence: es el que marca el límite real.
  const vence = beneficiarios
    .filter(b => !b?.cupoConfirmado && b?.cupoReservadoHasta)
    .map(b => new Date(b.cupoReservadoHasta).getTime())
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b)[0]

  if (!vence) return null

  const restante = vence - ahora

  if (restante <= 0) {
    return (
      <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
        <ExclamationTriangleIcon className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-bold text-red-800 uppercase">La reserva del cupo venció</p>
          <p className="text-red-700 mt-1">
            El asiento volvió a quedar disponible para otros contratos. Puedes marcar el contrato
            para aprobación igualmente: en ese momento se vuelve a comprobar el cupo y, si el salón
            se llenó, podrás cambiar de horario.
          </p>
        </div>
      </div>
    )
  }

  const min = Math.floor(restante / 60000)
  const seg = Math.floor((restante % 60000) / 1000)
  const urgente = restante < 10 * 60000

  return (
    <div
      className={`mb-6 rounded-lg p-4 flex items-start gap-3 border ${
        urgente ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'
      }`}
    >
      <ClockIcon className={`h-6 w-6 flex-shrink-0 mt-0.5 ${urgente ? 'text-orange-600' : 'text-amber-600'}`} />
      <div className="text-sm">
        <p className={`font-bold uppercase ${urgente ? 'text-orange-800' : 'text-amber-800'}`}>
          Cupo reservado &middot;{' '}
          <span className="tabular-nums">
            {min}:{String(seg).padStart(2, '0')}
          </span>
        </p>
        <p className={urgente ? 'text-orange-700 mt-1' : 'text-amber-700 mt-1'}>
          El asiento en el salón está apartado mientras se cierra la gestión. Marca el contrato para
          aprobación antes de que se acabe el tiempo o la reserva se libera.
        </p>
      </div>
    </div>
  )
}
