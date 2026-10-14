'use client'

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { XMarkIcon, CameraIcon } from '@heroicons/react/24/outline'

/**
 * Botón «Perfil» de /student/[id]: el mismo perfil que el alumno ve en su panel
 * ("Mi Perfil"), con los campos editables y la foto. El documento no se edita.
 *
 * La foto se sube directo a Spaces con el mismo flujo de /nuevo-usuario
 * (`photo-presign` + PUT público) y se guarda junto con el resto al pulsar Guardar.
 */
interface Perfil {
  academicaId: string
  numeroId: string
  primerNombre: string; segundoNombre: string; primerApellido: string; segundoApellido: string
  email: string; celular: string; fechaNacimiento: string; domicilio: string; ciudad: string
  plataforma: string; nivel: string; step: string; foto: string | null
}

const MAX_FOTO_MB = 5
const inputCls = 'w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-right focus:border-primary-500 focus:ring-primary-500'

export default function PerfilEstudianteModal({ academicaId, onClose }: { academicaId: string; onClose: () => void }) {
  const [p, setP] = useState<Perfil | null>(null)
  const [fotoNueva, setFotoNueva] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/postgres/students/${academicaId}/perfil`, { cache: 'no-store' })
      .then(r => r.json())
      .then(res => { if (!vivo) return; if (res.error) throw new Error(res.error); setP(res.perfil) })
      .catch(e => { toast.error(e?.message || 'No se pudo cargar el perfil'); onClose() })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicaId])

  const set = (k: keyof Perfil, v: string) => setP(prev => (prev ? { ...prev, [k]: v } : prev))

  const subirFoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Selecciona una imagen'); return }
    if (file.size > MAX_FOTO_MB * 1024 * 1024) { toast.error(`La foto no puede pesar más de ${MAX_FOTO_MB} MB`); return }
    setSubiendo(true)
    try {
      const pre = await fetch('/api/nuevo-usuario/photo-presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicaId, contentType: file.type }),
      }).then(r => r.json())
      if (pre.error || !pre.presignedUrl) throw new Error(pre.error || 'No se pudo preparar la subida')
      // `x-amz-acl` debe coincidir con la firma del presign (public-read): sin él
      // el objeto queda privado y la foto no se ve.
      const put = await fetch(pre.presignedUrl, {
        method: 'PUT', body: file, headers: { 'Content-Type': file.type, 'x-amz-acl': 'public-read' },
      })
      if (!put.ok) throw new Error(`La subida falló (${put.status})`)
      setFotoNueva(pre.publicUrl)
      toast.success('Foto cargada: pulsa Guardar para dejarla')
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo subir la foto')
    } finally { setSubiendo(false) }
  }

  const guardar = async () => {
    if (!p) return
    if (!p.primerNombre.trim() || !p.primerApellido.trim()) { toast.error('Primer nombre y primer apellido son obligatorios'); return }
    setGuardando(true)
    try {
      const res = await fetch(`/api/postgres/students/${academicaId}/perfil`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, foto: fotoNueva ?? undefined }),
      }).then(r => r.json())
      if (res.error) throw new Error(res.error)
      if (!res.cambios?.length) { toast('No había cambios'); onClose(); return }
      toast.success('Perfil actualizado')
      // La ficha toma los datos al cargar: se recarga para que el encabezado y la
      // tarjeta muestren lo nuevo.
      setTimeout(() => window.location.reload(), 600)
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar')
    } finally { setGuardando(false) }
  }

  const foto = fotoNueva || p?.foto || null
  const iniciales = p ? `${p.primerNombre?.[0] || ''}${p.primerApellido?.[0] || ''}`.toUpperCase() : ''
  // Función (no componente): un componente declarado dentro del render se
  // recrearía en cada tecla y el campo perdería el foco.
  const fila = (label: string, k: keyof Perfil, type = 'text') => (
    <div key={String(k)} className="flex items-center justify-between gap-4 py-2">
      <label className="w-40 shrink-0 text-sm text-gray-500" htmlFor={`perf-${String(k)}`}>{label}</label>
      <input id={`perf-${String(k)}`} type={type} className={inputCls} value={(p?.[k] as string) || ''}
        onChange={e => set(k, e.target.value)} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Perfil</h3>
          <button type="button" onClick={onClose} title="Cerrar" className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {!p ? (
          <p className="py-16 text-center text-sm text-gray-500">Cargando…</p>
        ) : (
          <div className="px-6 py-5">
            {/* Foto + nombre, como en "Mi Perfil" del panel del alumno */}
            <div className="flex flex-col items-center gap-2 pb-4 border-b">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo}
                title="Cambiar foto"
                className="relative h-24 w-24 rounded-full border-2 border-primary-200 bg-primary-50 overflow-hidden group">
                {foto
                  ? <img src={foto} alt="Foto del alumno" className="h-full w-full object-cover" />
                  : <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-primary-700">{iniciales}</span>}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <CameraIcon className="h-7 w-7" />
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) subirFoto(f); e.target.value = '' }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo}
                className="text-xs font-medium text-primary-700 hover:underline disabled:opacity-50">
                {subiendo ? 'Subiendo foto…' : foto ? 'Cambiar foto' : 'Agregar foto'}
              </button>
              <p className="text-base font-semibold text-gray-900 text-center">
                {[p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido].filter(Boolean).join(' ')}
              </p>
              {(p.nivel || p.step) && (
                <span className="rounded-full bg-primary-100 px-3 py-0.5 text-xs font-medium text-primary-800">
                  {[p.nivel, p.step].filter(Boolean).join(' - ')}
                </span>
              )}
            </div>

            <div className="divide-y divide-gray-50 pt-2">
              {fila('Primer nombre *', 'primerNombre')}
              {fila('Segundo nombre', 'segundoNombre')}
              {fila('Primer apellido *', 'primerApellido')}
              {fila('Segundo apellido', 'segundoApellido')}
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="w-40 shrink-0 text-sm text-gray-500">Número de ID</span>
                <span className="text-sm text-gray-900" title="El documento no se edita: es la llave del alumno">{p.numeroId}</span>
              </div>
              {fila('Email', 'email', 'email')}
              {fila('Celular', 'celular')}
              {fila('Fecha de nacimiento', 'fechaNacimiento', 'date')}
              {fila('Domicilio', 'domicilio')}
              {fila('Ciudad', 'ciudad')}
              <div className="flex items-center justify-between gap-4 py-2">
                <span className="w-40 shrink-0 text-sm text-gray-500">Plataforma</span>
                <span className="text-sm text-gray-900">{p.plataforma || '—'}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <button type="button" onClick={onClose} disabled={guardando}
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!p || guardando || subiendo}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
