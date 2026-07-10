'use client'

export default function ActualizarMaterialPage() {
  const openTab = (path: string) => window.open(path, '_blank', 'noopener,noreferrer')

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Mantenimiento Cursos</h1>
      <p className="text-gray-500 mb-8">Selecciona qué deseas gestionar, esta acción genera registros de auditoría.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Subir Curso (CSV) */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/subir-curso')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-rose-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center group-hover:bg-rose-100 transition-colors">
            <svg className="w-8 h-8 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-rose-600 transition-colors">Subir Curso</div>
            <div className="text-sm text-gray-500 mt-1">Crear módulos y lecciones desde CSV</div>
          </div>
        </button>

        {/* Imágenes de curso */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/imagenes')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-fuchsia-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-fuchsia-50 rounded-full flex items-center justify-center group-hover:bg-fuchsia-100 transition-colors">
            <svg className="w-8 h-8 text-fuchsia-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-fuchsia-600 transition-colors">Imágenes de curso</div>
            <div className="text-sm text-gray-500 mt-1">Una imagen por tipo de curso</div>
          </div>
        </button>

        {/* Videos */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/videos')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-purple-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center group-hover:bg-purple-100 transition-colors">
            <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-purple-600 transition-colors">Videos</div>
            <div className="text-sm text-gray-500 mt-1">Video por lección (MP4 o enlace)</div>
          </div>
        </button>

        {/* Contenido */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/contenido')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-indigo-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
            <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">Contenido</div>
            <div className="text-sm text-gray-500 mt-1">Temario por lección (quiz IA)</div>
          </div>
        </button>

        {/* Usuarios */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/usuarios')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center group-hover:bg-blue-100 transition-colors">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 20h5v-2a4 4 0 00-5.356-3.712M9 20H4v-2a4 4 0 015.356-3.712M15 7a4 4 0 11-8 0 4 4 0 018 0zm6 4a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">Usuarios</div>
            <div className="text-sm text-gray-500 mt-1">Material para estudiantes</div>
          </div>
        </button>

        {/* Advisor */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/advisor')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-green-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center group-hover:bg-green-100 transition-colors">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-green-600 transition-colors">Guía</div>
            <div className="text-sm text-gray-500 mt-1">Material para advisors</div>
          </div>
        </button>

        {/* Interactivo */}
        <button
          type="button"
          onClick={() => openTab('/dashboard/academic/actualizar-material/interactivo')}
          className="flex flex-col items-center justify-center gap-4 p-10 bg-white border-2 border-gray-200 rounded-2xl shadow-sm hover:border-emerald-500 hover:shadow-md transition-all text-left group"
        >
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors">Interactivo</div>
            <div className="text-sm text-gray-500 mt-1">Libros con páginas + audios</div>
          </div>
        </button>
      </div>
    </div>
  )
}
