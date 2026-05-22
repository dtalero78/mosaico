'use client'

/**
 * SVG inline de banderas de Chile/Colombia/Ecuador.
 * Reemplaza los emoji 🇨🇱 🇨🇴 🇪🇨 porque Windows los renderiza como texto
 * "CL"/"CO"/"EC" en lugar de banderas (limitación del SO).
 *
 * Ecuador y Colombia tienen los mismos colores horizontales; se distinguen
 * con un pequeño círculo central (simplificación del escudo de Ecuador).
 */

import type { CountryCode } from '@/lib/festivos'

interface CountryFlagProps {
  country: CountryCode
  /** Píxeles de ancho (default 14). Alto se ajusta proporcional a 2:3 → 14×10 */
  width?: number
  className?: string
}

export default function CountryFlag({ country, width = 14, className = '' }: CountryFlagProps) {
  const height = Math.round((width * 10) / 14)
  const common = { width, height, className: `inline-block align-middle rounded-sm overflow-hidden ${className}`, viewBox: '0 0 30 20' as const }

  if (country === 'CL') {
    return (
      <svg {...common} xmlns="http://www.w3.org/2000/svg" aria-label="Chile">
        <rect width="30" height="10" fill="#ffffff"/>
        <rect y="10" width="30" height="10" fill="#D52B1E"/>
        <rect width="10" height="10" fill="#0039A6"/>
        <polygon points="5,2 5.9,5 9,5 6.55,6.85 7.5,9.85 5,8.05 2.5,9.85 3.45,6.85 1,5 4.1,5" fill="#ffffff"/>
      </svg>
    )
  }

  if (country === 'CO') {
    return (
      <svg {...common} xmlns="http://www.w3.org/2000/svg" aria-label="Colombia">
        <rect width="30" height="10" fill="#FCD116"/>
        <rect y="10" width="30" height="5" fill="#003893"/>
        <rect y="15" width="30" height="5" fill="#CE1126"/>
      </svg>
    )
  }

  // EC — mismos colores que Colombia + círculo central (escudo simplificado)
  return (
    <svg {...common} xmlns="http://www.w3.org/2000/svg" aria-label="Ecuador">
      <rect width="30" height="10" fill="#FFDD00"/>
      <rect y="10" width="30" height="5" fill="#0E47A1"/>
      <rect y="15" width="30" height="5" fill="#E4313D"/>
      <circle cx="15" cy="10" r="2.5" fill="#0E47A1" stroke="#ffffff" strokeWidth="0.6"/>
    </svg>
  )
}
