'use client'

/**
 * Renderiza un emoji discreto cuando la fecha es festivo en Chile/Colombia/Ecuador.
 * Al hover muestra un tooltip CSS con el nombre del festivo por país.
 *
 * Si la fecha NO es festivo, NO renderiza nada (null).
 *
 * Uso:
 *   <HolidayBadge date={new Date(2026, 4, 1)} />
 *   <HolidayBadge date="2026-05-01" />
 */

import { getHolidays, getCountryLabel, type CountryCode } from '@/lib/festivos'
import CountryFlag from '@/components/common/CountryFlag'

interface HolidayBadgeProps {
  date: Date | string
  /** Tamaño del emoji (default 'sm') */
  size?: 'xs' | 'sm' | 'md'
  /** Dónde se posiciona el tooltip (default 'top') */
  placement?: 'top' | 'bottom'
  /** className extra para el contenedor */
  className?: string
}

export default function HolidayBadge({ date, size = 'sm', placement = 'top', className = '' }: HolidayBadgeProps) {
  const holidays = getHolidays(date)
  if (holidays.length === 0) return null

  // Lista única de países con festivo ese día
  const countries = Array.from(new Set(holidays.map((h) => h.country))) as CountryCode[]
  const flagWidth = size === 'xs' ? 12 : size === 'md' ? 18 : 14

  const sizeCls =
    size === 'xs' ? 'text-[10px]' :
    size === 'md' ? 'text-base' :
                    'text-xs'

  const placementCls = placement === 'bottom'
    ? 'top-full mt-1'
    : 'bottom-full mb-1'

  return (
    <span className={`relative inline-flex items-center group cursor-default select-none ${sizeCls} ${className}`}>
      {/* 1 país → bandera SVG ; 2+ países → 🌎 (emoji renderiza OK en todos los sistemas) */}
      {countries.length >= 2 ? (
        <span className="leading-none" aria-label="Festivo en múltiples países">🌎</span>
      ) : (
        <CountryFlag country={countries[0]} width={flagWidth} />
      )}

      {/* Tooltip CSS-only */}
      <span
        role="tooltip"
        className={`
          pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 ${placementCls}
          whitespace-nowrap rounded-md bg-gray-900/95 text-white shadow-lg
          px-2 py-1.5 text-[11px] leading-tight
          opacity-0 scale-95 transition-all duration-150
          group-hover:opacity-100 group-hover:scale-100
        `}
      >
        {holidays.map((h, i) => (
          <span key={`${h.country}-${i}`} className="flex items-center gap-1.5">
            <CountryFlag country={h.country} width={14} />
            <span className="font-semibold">{getCountryLabel(h.country)}:</span>
            <span>{h.name}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
