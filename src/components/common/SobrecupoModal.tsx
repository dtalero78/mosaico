'use client'

import { useState } from 'react'

/**
 * Detalle que devuelve el servidor cuando el agendamiento se pasa del cupo.
 * Viaja en `detail` del error 409 (mismo patrón que la colisión de guía).
 */
export interface SobrecupoDetalle {
  tipo: 'sobrecupo'
  limite: number
  ocupados: number
  agendar: number
  sobran: number
}

/** ¿El error que devolvió el servidor es un sobrecupo? */
export function esSobrecupo(detail: any): detail is SobrecupoDetalle {
  return !!detail && detail.tipo === 'sobrecupo'
}

/**
 * Aviso de sobrecupo con autorización explícita.
 *
 * El evento lleno ya no se salta en silencio: quien tiene el permiso ve cuánto
 * se pasa y lo autoriza marcando la casilla, y el agendamiento guarda quién fue.
 * Sin el permiso, el modal sólo explica por qué no se puede.
 */
export default function SobrecupoModal({
  detalle,
  puedeAutorizar,
  procesando,
  onCancel,
  onConfirm,
}: {
  detalle: SobrecupoDetalle
  puedeAutorizar: boolean
  procesando?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [confirmado, setConfirmado] = useState(false)
  const quedaria = detalle.ocupados + detalle.agendar

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {puedeAutorizar ? 'El evento está lleno' : 'No hay cupo en el evento'}
          </h3>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            <div className="flex justify-between"><span>Cupo del evento</span><span className="font-semibold">{detalle.limite}</span></div>
            <div className="flex justify-between"><span>Ya inscritos</span><span className="font-semibold">{detalle.ocupados}</span></div>
            <div className="flex justify-between"><span>Vas a agendar</span><span className="font-semibold">{detalle.agendar}</span></div>
            <div className="flex justify-between border-t border-amber-200 mt-2 pt-2">
              <span className="font-medium">Quedaría en</span>
              <span className="font-bold">{quedaria} de {detalle.limite}</span>
            </div>
          </div>

          {puedeAutorizar ? (
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmado}
                onChange={(e) => setConfirmado(e.target.checked)}
                className="mt-0.5 rounded border-gray-300"
              />
              <span>
                Autorizo el sobrecupo de <strong>{detalle.sobran}</strong> {detalle.sobran === 1 ? 'lugar' : 'lugares'}.
                <span className="block text-xs text-gray-500 mt-0.5">Queda registrado con tu usuario y la fecha.</span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-gray-600">
              No tienes permiso para autorizar un sobrecupo. Pide a Coordinación que lo autorice
              o elige otro evento con lugares disponibles.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onCancel} disabled={procesando}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          {puedeAutorizar && (
            <button
              onClick={onConfirm}
              disabled={!confirmado || procesando}
              className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {procesando ? 'Agendando…' : 'Agendar igual'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
