'use client'

/**
 * Badge para el campo PEOPLE.estado (ciclo de vida operativo del contrato).
 *
 * Distinto al badge de `aprobacion` (decisión comercial: Aprobado / Pendiente
 * / Rechazado / etc.). Aquí mostramos la "máquina de estados" interna:
 *   ACTIVA · On Hold · CON EXTENSION · FINALIZADA · PENDIENTE · RETRACTADO ·
 *   ANULADO · (null → Null)
 *
 * Si `estado` es null/undefined/'' muestra "Null" en fondo negro.
 *
 * Uso:
 *   <EstadoBadge estado={person.estado} />
 *   <EstadoBadge estado={person.estado} prefix="Estado: " />
 */

interface EstadoBadgeProps {
  estado: string | null | undefined
  /** Texto opcional antes del badge (ej. "Estado: ") */
  prefix?: string
  /** Tamaño del badge (default 'sm') */
  size?: 'xs' | 'sm' | 'md'
}

const META: Record<string, { label: string; cls: string }> = {
  ACTIVA:          { label: 'ACTIVA',         cls: 'bg-green-100 text-green-800' },
  'On Hold':       { label: 'On Hold',        cls: 'bg-sky-100 text-sky-800' },
  'CON EXTENSION': { label: 'CON EXTENSION',  cls: 'bg-emerald-200 text-emerald-900' },
  'CIERRE A CUOTAS': { label: 'CIERRE A CUOTAS', cls: 'bg-amber-200 text-amber-900' },
  FINALIZADA:      { label: 'FINALIZADA',     cls: 'bg-red-500 text-white' },
  PENDIENTE:       { label: 'PENDIENTE',      cls: 'bg-orange-200 text-orange-900' },
  RETRACTADO:      { label: 'RETRACTADO',     cls: 'bg-gray-300 text-gray-800' },
  ANULADO:         { label: 'ANULADO',        cls: 'bg-red-900 text-white' },
}

const NULL_META = { label: 'Null', cls: 'bg-black text-white' }

export default function EstadoBadge({ estado, prefix, size = 'sm' }: EstadoBadgeProps) {
  const value = (estado ?? '').toString().trim()
  const meta = value ? (META[value] || { label: value, cls: 'bg-gray-200 text-gray-700' }) : NULL_META

  const sizeCls =
    size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' :
    size === 'md' ? 'px-3 py-1 text-sm' :
                    'px-2 py-0.5 text-xs'

  return (
    <span className="inline-flex items-center gap-1">
      {prefix && <span className="text-gray-600">{prefix}</span>}
      <span className={`inline-flex items-center font-semibold rounded-full ${sizeCls} ${meta.cls}`}>
        {meta.label}
      </span>
    </span>
  )
}
