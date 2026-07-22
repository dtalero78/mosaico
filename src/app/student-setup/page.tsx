'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { UserCircleIcon, CameraIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

/**
 * Actualización de Datos (panel del usuario). Versión MOSAICO reducida:
 * foto (opcional) + Usuario (userLogin, solo lectura) + Email (solo lectura)
 * + Celular. Paleta primary/accent de MOSAICO.
 */
export default function StudentSetupPage() {
  const { data: session, status } = useSession()
  const sessionEmail = session?.user?.email ?? ''

  const [celular,       setCelular]       = useState('')
  const [userLogin,     setUserLogin]     = useState('')
  const [fotoFile,      setFotoFile]      = useState<File | null>(null)
  const [fotoPreview,   setFotoPreview]   = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Cargar perfil para mostrar el usuario de ingreso (userLogin)
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/postgres/panel-estudiante/me')
      .then(r => r.json())
      .then(data => {
        const prof = data?.data?.profile ?? data?.profile
        setUserLogin(prof?.userLogin || '')
        setProfileLoaded(true)
      })
      .catch(() => setProfileLoaded(true))
  }, [status])

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes'); return }
    setFotoFile(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  const handleCancel = () => {
    window.location.href = '/panel-estudiante'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!sessionEmail) { toast.error('No se encontró email en la sesión'); return }
    if (celular.trim() && !/^\d+$/.test(celular.trim())) { toast.error('El celular solo debe contener números (sin + ni espacios)'); return }

    setSaving(true)
    try {
      let fotoUrl: string | null = null

      if (fotoFile) {
        const presignRes = await fetch('/api/nuevo-usuario/photo-presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            academicaId: `student_${Date.now()}`,
            contentType: fotoFile.type,
          }),
        })
        const presignData = await presignRes.json()
        if (presignData.success) {
          const uploadRes = await fetch(presignData.presignedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': fotoFile.type },
            body: fotoFile,
          })
          if (uploadRes.ok) fotoUrl = presignData.publicUrl
        }
      }

      const res = await fetch('/api/postgres/panel-estudiante/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:   sessionEmail.toLowerCase(),
          celular: celular.trim() || undefined,
          fotoUrl: fotoUrl || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error al guardar')

      toast.success('¡Perfil actualizado!')
      setTimeout(() => { window.location.href = '/panel-estudiante' }, 1200)
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar el perfil')
    } finally {
      setSaving(false)
    }
  }

  if (!profileLoaded || status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg overflow-hidden">

        {/* Header — paleta MOSAICO */}
        <div className="bg-gradient-to-r from-primary-700 to-accent-600 px-6 py-5">
          <h1 className="text-xl font-bold text-white">Actualización de Datos</h1>
          <p className="text-white/80 text-sm mt-1">
            Mantén tu información actualizada.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">

          {/* Foto */}
          <div className="flex flex-col items-center gap-2 mb-2">
            <div
              className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-primary-200 cursor-pointer hover:opacity-90 transition"
              onClick={() => fileRef.current?.click()}
            >
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto" className="w-full h-full object-cover" />
                : <UserCircleIcon className="w-full h-full text-gray-300 p-2" />
              }
              <div className="absolute bottom-0 inset-x-0 bg-primary-600 bg-opacity-80 flex items-center justify-center py-1">
                <CameraIcon className="h-3.5 w-3.5 text-white" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto}
              title="Subir foto de perfil" aria-label="Subir foto de perfil" />
            <p className="text-xs text-gray-500">Foto de perfil (opcional)</p>
          </div>

          {/* Usuario — readonly */}
          <div>
            <label htmlFor="ss-usuario" className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
            <input
              id="ss-usuario"
              type="text"
              value={userLogin || '—'}
              readOnly
              title="Usuario de ingreso a la plataforma (no modificable)"
              placeholder="usuario"
              className="w-full px-3 py-2 border border-primary-200 rounded-lg text-sm bg-primary-50 text-primary-800 font-mono cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Con este usuario ingresas a la plataforma.</p>
          </div>

          {/* Email — readonly */}
          <div>
            <label htmlFor="ss-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="ss-email"
              type="email"
              value={sessionEmail}
              readOnly
              title="Email de la cuenta (no modificable)"
              placeholder="tu@email.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">El email no puede modificarse.</p>
          </div>

          {/* Celular */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Celular <span className="text-xs text-gray-400">(con indicativo, solo números)</span>
            </label>
            <input type="tel" value={celular}
              onKeyDown={e => { if (!/^\d$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) e.preventDefault() }}
              onChange={e => setCelular(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="56912345678"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleCancel} disabled={saving}
              className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {saving ? 'Guardando...' : 'Guardar y Continuar'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
