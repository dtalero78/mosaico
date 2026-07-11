'use client'

import { ArrowLeftIcon, VideoCameraIcon } from '@heroicons/react/24/outline'

export default function ActualizarVideosPage() {
  const open = (path: string) => window.open(path, '_blank', 'noopener,noreferrer')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => window.close()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Cerrar
          </button>
          <div className="flex-1" />
          <h1 className="text-2xl font-bold text-gray-900">Actualizar Videos</h1>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-6">
          <button
            onClick={() => open('/admin/actualizar-videos/instructivos')}
            className="group bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-left hover:shadow-md hover:border-blue-300 transition-all"
          >
            <div className="h-14 w-14 bg-blue-100 rounded-xl flex items-center justify-center mb-5 group-hover:bg-blue-200 transition-colors">
              <VideoCameraIcon className="h-7 w-7 text-blue-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Instructivos</h2>
            <p className="text-sm text-gray-500">
              Gestiona los videos instructivos del panel del estudiante (subir, reemplazar, eliminar).
            </p>
            <span className="mt-4 inline-flex items-center text-sm font-medium text-blue-600 group-hover:gap-2 transition-all">
              Gestionar →
            </span>
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-400 text-center">
          Los videos por lección se gestionan en <strong>Académico › Guías › Mantenimiento Cursos › Videos</strong> (cascada Curso → Módulo → Lección).
        </p>
      </div>
    </div>
  )
}
