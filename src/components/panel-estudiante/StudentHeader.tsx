'use client'

import { signOut } from 'next-auth/react'
import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline'

interface StudentHeaderProps {
  profile: any
  isLoading: boolean
}

export default function StudentHeader({ profile, isLoading }: StudentHeaderProps) {
  if (isLoading) {
    return (
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-gray-200 flex-shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3.5 bg-gray-200 rounded w-32" />
            <div className="h-3 bg-gray-200 rounded w-24" />
          </div>
        </div>
        <div className="h-4 bg-gray-200 rounded w-20" />
      </div>
    )
  }

  const nombre   = profile?.primerNombre  || ''
  const apellido = profile?.primerApellido || ''
  const nivel    = profile?.nivel          || ''
  const step     = profile?.effectiveStep  || profile?.step || ''
  const foto     = profile?.foto           || null

  // Only DO Spaces URLs are publicly accessible; wix:// URLs are not
  const fotoUrl = foto && foto.startsWith('https://') ? foto : null

  // Initials fallback (up to 2 chars)
  const initials = `${nombre[0] || ''}${apellido[0] || ''}`.toUpperCase()

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">

        {/* Left: Avatar + name + subtitle */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Avatar */}
          <div className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center border border-gray-200">
            {fotoUrl
              ? <img src={fotoUrl} alt={nombre} className="h-full w-full object-cover" />
              : <span className="text-xs sm:text-sm font-semibold text-primary-700">{initials}</span>
            }
          </div>

          {/* Name + subtitle */}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              ¡Hola, {nombre}<span className="hidden sm:inline"> {apellido}</span>!
            </p>
            <p className="text-xs text-gray-500 hidden sm:block">Panel de gestión para Usuarios</p>
            <p className="text-xs text-gray-500 sm:hidden">Panel de usuario</p>
          </div>
        </div>

        {/* Right: nivel badge + logout */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {nivel && (
            <span className="text-xs font-medium bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full whitespace-nowrap">
              {nivel}{step ? ` - ${step}` : ''}
            </span>
          )}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600"
            title="Cerrar sesión"
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
          </button>
        </div>

      </div>
    </div>
  )
}
