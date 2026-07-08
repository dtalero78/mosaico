'use client'

import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { PermissionGuard } from '@/components/permissions'
import { AcademicoPermission } from '@/types/permissions'

interface CursoImagen {
  tipoCurso: string
  imagen: string | null
  url: string | null
}

function CursoCard({ curso, onChanged }: { curso: CursoImagen; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen')
      return
    }
    setBusy(true)
    try {
      // 1) presign
      const pres = await fetch('/api/postgres/cursos-imagenes/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoCurso: curso.tipoCurso, contentType: file.type }),
      }).then((r) => r.json())
      if (!pres.presignedUrl || !pres.key) throw new Error(pres.error || 'No se pudo firmar la subida')

      // 2) PUT directo a Spaces
      const put = await fetch(pres.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('Falló la subida a almacenamiento')

      // 3) guardar la key
      const patch = await fetch(`/api/postgres/cursos-imagenes/${curso.tipoCurso}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: pres.key }),
      }).then((r) => r.json())
      if (patch.error) throw new Error(patch.error)

      toast.success(`Imagen de ${curso.tipoCurso} actualizada`)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Error al subir la imagen')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Quitar la imagen de ${curso.tipoCurso}?`)) return
    setBusy(true)
    try {
      const patch = await fetch(`/api/postgres/cursos-imagenes/${curso.tipoCurso}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: null }),
      }).then((r) => r.json())
      if (patch.error) throw new Error(patch.error)
      toast.success(`Imagen de ${curso.tipoCurso} eliminada`)
      onChanged()
    } catch (e: any) {
      toast.error(e?.message || 'Error al eliminar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border-2 border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      <div className="relative aspect-video bg-gray-100 flex items-center justify-center">
        {curso.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={curso.url} alt={curso.tipoCurso} className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-400 text-sm">Sin imagen</span>
        )}
        {busy && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="font-semibold text-gray-900">{curso.tipoCurso}</div>
        <div className="flex items-center gap-2">
          <label className="flex-1 cursor-pointer text-center px-3 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm rounded-lg transition-colors">
            {curso.imagen ? 'Reemplazar' : 'Subir imagen'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
          </label>
          {curso.imagen && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="px-3 py-2 border border-red-300 text-red-600 hover:bg-red-50 text-sm rounded-lg transition-colors"
            >
              Quitar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ImagenesCursoPage() {
  const [cursos, setCursos] = useState<CursoImagen[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/postgres/cursos-imagenes', { cache: 'no-store' }).then((x) => x.json())
      setCursos(r.cursos || [])
    } catch {
      toast.error('No se pudieron cargar las imágenes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <PermissionGuard permission={AcademicoPermission.ACTUALIZAR_MATERIAL} showDefaultMessage>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Imágenes de curso</h1>
        <p className="text-gray-500 mb-8">
          Sube una imagen por tipo de curso. Se usará en el panel del estudiante. Formatos: JPG, PNG, WEBP.
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-2 border-fuchsia-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {cursos.map((c) => (
              <CursoCard key={c.tipoCurso} curso={c} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </PermissionGuard>
  )
}
