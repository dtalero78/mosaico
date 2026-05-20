'use client'

/**
 * Badge "SUSPENDIDA" para mostrar que un contrato está suspendido
 * administrativamente (toggle Activo→Inactivo en Administración tab).
 *
 * Sólo se renderiza si `show=true`. Diseño: fondo amarillo, borde
 * amarillo oscuro, texto rojo, ícono ⚠️ — alerta sin ser alarmante.
 *
 * Es puramente informativo (no clickeable). Tooltip al hover orienta
 * al usuario hacia la pestaña Administración.
 */

interface SuspendidaBadgeProps {
  show: boolean
}

export default function SuspendidaBadge({ show }: SuspendidaBadgeProps) {
  if (!show) return null
  return (
    <span
      title="Contrato suspendido administrativamente. Revisa la pestaña Administración para más detalles."
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-yellow-400 bg-yellow-200 text-red-700 text-xs font-bold uppercase tracking-wide"
    >
      ⚠️ SUSPENDIDA
    </span>
  )
}
