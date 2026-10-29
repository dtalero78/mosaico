'use client'

/**
 * Aviso cuando se agenda una NIVELACIÓN y el alumno ya tiene otra clase a esa hora.
 * Si quien agenda confirma que la nivelación prevalece, el servidor cancela ESA clase
 * (sólo para ese alumno; el evento sigue para los demás) y agenda la nivelación.
 */
export interface CruceNivelacionDetalle {
  tipo: 'cruce_nivelacion'
  cruces: { bookingId: string; alumno: string; evento: string; tipo: string; fecha: string }[]
}

export function esCruceNivelacion(detail: any): detail is CruceNivelacionDetalle {
  return !!detail && detail.tipo === 'cruce_nivelacion' && Array.isArray(detail.cruces)
}

const fmt = (iso: string) => {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

export default function CruceNivelacionModal({ detalle, procesando, onCancel, onConfirm }: {
  detalle: CruceNivelacionDetalle
  procesando?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-amber-800">⚠ Hay clases que se cruzan con la nivelación</h3>
        <p className="mt-1 text-sm text-gray-700">
          Estos alumnos ya tienen otro evento en el mismo horario de la nivelación:
        </p>
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-amber-200 bg-amber-50">
          {detalle.cruces.map(c => (
            <li key={c.bookingId} className="px-3 py-2 text-sm">
              <b>{c.alumno}</b> — {c.evento} <span className="text-gray-500">({c.tipo || 'clase'} · {fmt(c.fecha)})</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-gray-700">
          ¿<b>Prevalece la nivelación</b>? Si confirmas, se <b>cancela ese evento únicamente para cada uno de estos alumnos</b>
          (el evento sigue para los demás) y se agenda la nivelación.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={procesando}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            No, mantener sus clases
          </button>
          <button type="button" onClick={onConfirm} disabled={procesando}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {procesando ? 'Procesando…' : 'Sí, prevalece la nivelación'}
          </button>
        </div>
      </div>
    </div>
  )
}
