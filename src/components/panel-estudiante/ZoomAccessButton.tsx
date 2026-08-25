'use client'

import { useState } from 'react'

/**
 * Acceso a Zoom de la "Sesión próxima" del panel del estudiante.
 *
 * Dos estados, según la ventana de conexión (la decide `lib/zoom-window`):
 *  - disponible → ícono de cámara a color; deja constancia del acceso y abre Zoom
 *    en una pestaña nueva.
 *  - bloqueado  → ícono de reloj; al pulsarlo explica por qué no puede entrar.
 *
 * El texto que acompaña al ícono NO vive aquí: lo pinta la tarjeta, que sabe en
 * cuál de los cuatro estados está el alumno.
 */

/** Ícono a color: la sesión está abierta. */
function IconoActivo({ size = 52 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="zoomAccesoActivo">
          <rect x="2" y="2" width="60" height="60" rx="16" />
        </clipPath>
      </defs>
      <g clipPath="url(#zoomAccesoActivo)">
        <rect x="2" y="2" width="30" height="30" fill="#1e3a8a" />
        <rect x="32" y="2" width="30" height="30" fill="#2f6bf0" />
        <rect x="2" y="32" width="30" height="30" fill="#2450c8" />
        <rect x="32" y="32" width="30" height="30" fill="#4d8bff" />
      </g>
      <g fill="#ffffff">
        <rect x="17" y="24" width="21" height="16" rx="5.5" />
        <path d="M40 30.5l7.5-4.6c.7-.4 1.5.1 1.5.9v10.4c0 .8-.8 1.3-1.5.9L40 33.5z" />
      </g>
      {/* Distintivo de "listo": círculo verde con visto, sobre un anillo blanco
          que lo despega del azul del fondo. */}
      <circle cx="49" cy="15" r="10.5" fill="#ffffff" />
      <circle cx="49" cy="15" r="8.4" fill="#22c55e" />
      <path d="M45 15.2l2.8 2.8 5.2-5.4" fill="none" stroke="#ffffff" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ícono apagado con reloj: aún no (o ya no) es la hora. */
function IconoEspera({ size = 52 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="zoomAccesoEspera">
          <rect x="2" y="2" width="60" height="60" rx="16" />
        </clipPath>
      </defs>
      <g clipPath="url(#zoomAccesoEspera)">
        <rect x="2" y="2" width="30" height="30" fill="#334155" />
        <rect x="32" y="2" width="30" height="30" fill="#7c899c" />
        <rect x="2" y="32" width="30" height="30" fill="#475569" />
        <rect x="32" y="32" width="30" height="30" fill="#8b97a8" />
      </g>
      <g fill="#e6e9ee">
        <rect x="17" y="24" width="21" height="16" rx="5.5" />
        <path d="M40 30.5l7.5-4.6c.7-.4 1.5.1 1.5.9v10.4c0 .8-.8 1.3-1.5.9L40 33.5z" />
      </g>
      <circle cx="49" cy="15" r="10" fill="#ffffff" />
      <circle cx="49" cy="15" r="7.6" fill="none" stroke="#e8730f" strokeWidth="2.6" />
      <path d="M49 10.6v4.8l3.2 2" fill="none" stroke="#e8730f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export const MENSAJE_FUERA_DE_HORA = 'No es tiempo de la sesión académica'

interface Props {
  /** URL de Zoom del evento. */
  zoomLink: string
  /** true dentro de la ventana de conexión. */
  disponible: boolean
  /** Deja constancia del acceso antes de abrir Zoom (ver ZOOM_ACCESOS). */
  onAcceso?: () => void
  /** Por qué está bloqueado, si no es simplemente que aún no es la hora. */
  mensajeBloqueado?: string
}

export default function ZoomAccessButton({
  zoomLink, disponible, onAcceso, mensajeBloqueado,
}: Props) {
  const [aviso, setAviso] = useState(false)

  if (disponible) {
    return (
      <a
        href={zoomLink}
        target="_blank"
        rel="noopener noreferrer"
        // Se registra el acceso y se deja seguir al enlace sin esperar la
        // respuesta: la bitácora no debe retrasar la entrada a clase.
        onClick={() => onAcceso?.()}
        title="Entrar a la sesión"
        aria-label="Entrar a la sesión de Zoom"
        className="inline-block rounded-2xl transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      >
        <IconoActivo />
      </a>
    )
  }

  const motivo = mensajeBloqueado || MENSAJE_FUERA_DE_HORA
  return (
    <div>
      <button
        type="button"
        onClick={() => setAviso(true)}
        title={motivo}
        aria-label={motivo}
        className="inline-block rounded-2xl cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      >
        <IconoEspera />
      </button>
      {aviso && (
        <p className="mt-1.5 inline-block rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700">
          {motivo}
        </p>
      )}
    </div>
  )
}
