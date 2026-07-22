'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { UserCircleIcon, CameraIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

export default function StudentSetupPage() {
  const { data: session, status } = useSession()
  const sessionEmail = session?.user?.email ?? ''

  const [password,        setPassword]        = useState('')
  const [showPass,        setShowPass]        = useState(false)
  const [password2,       setPassword2]       = useState('')
  const [showPass2,       setShowPass2]       = useState(false)
  const [celular,         setCelular]         = useState('')
  const [domicilio,       setDomicilio]       = useState('')
  const [ciudad,          setCiudad]          = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [fotoFile,        setFotoFile]        = useState<File | null>(null)
  const [fotoPreview,     setFotoPreview]     = useState<string | null>(null)
  const [saving,          setSaving]          = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Campos opcionales: solo se muestran si están vacíos en el perfil
  const [detallesPersonales, setDetallesPersonales] = useState('')
  const [hobbies,             setHobbies]             = useState('')
  const [showPersonalFields,  setShowPersonalFields]  = useState(false)
  const [profileLoaded,       setProfileLoaded]       = useState(false)

  // Cargar perfil para verificar si detallesPersonales/hobbies están vacíos
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/postgres/panel-estudiante/me')
      .then(r => r.json())
      .then(data => {
        const prof = data?.data?.profile ?? data?.profile
        const hasDetalles = !!prof?.detallesPersonales?.trim()
        const hasHobbies  = !!prof?.hobbies?.trim()
        setShowPersonalFields(!hasDetalles || !hasHobbies)
        setProfileLoaded(true)
      })
      .catch(() => { setShowPersonalFields(true); setProfileLoaded(true) })
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
    if (password.trim()) {
      if (/\s/.test(password)) { toast.error('La contraseña no puede contener espacios'); return }
      if (password !== password2) { toast.error('Las contraseñas no coinciden'); return }
    }
    if (showPersonalFields) {
      if (!detallesPersonales.trim()) { toast.error('Por favor cuéntanos sobre ti'); return }
      if (!hobbies.trim()) { toast.error('Por favor ingresa tus hobbies'); return }
    }

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
          email:              sessionEmail.toLowerCase(),
          password:           password.trim() || undefined,
          celular:            celular.trim() || undefined,
          domicilio:          domicilio.trim() || undefined,
          ciudad:             ciudad.trim() || undefined,
          fechaNacimiento:    fechaNacimiento || undefined,
          fotoUrl:            fotoUrl || undefined,
          detallesPersonales: showPersonalFields ? detallesPersonales.trim() || undefined : undefined,
          hobbies:            showPersonalFields ? hobbies.trim() || undefined : undefined,
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
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="bg-blue-600 px-6 py-5">
          <h1 className="text-xl font-bold text-white">Actualización de Datos</h1>
          <p className="text-blue-100 text-sm mt-1">
            Mantén tu información actualizada.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">

          {/* Campos personales — solo si están vacíos en el perfil */}
          {showPersonalFields && (
            <>
              <div>
                <label htmlFor="ss-detalles" className="block text-sm font-medium text-gray-700 mb-1">
                  Cuéntanos sobre ti *
                </label>
                <textarea
                  id="ss-detalles"
                  value={detallesPersonales}
                  onChange={e => setDetallesPersonales(e.target.value)}
                  rows={3}
                  placeholder="¿Qué te motivó a tomar el curso? ¡Déjanos saber!"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="ss-hobbies" className="block text-sm font-medium text-gray-700 mb-1">
                  Hobbies e intereses *
                </label>
                <textarea
                  id="ss-hobbies"
                  value={hobbies}
                  onChange={e => setHobbies(e.target.value)}
                  rows={2}
                  placeholder="¿Qué te gusta hacer en tu tiempo libre?"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* Foto */}
          <div className="flex flex-col items-center gap-2 mb-2">
            <div
              className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-blue-200 cursor-pointer hover:opacity-90 transition"
              onClick={() => fileRef.current?.click()}
            >
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto" className="w-full h-full object-cover" />
                : <UserCircleIcon className="w-full h-full text-gray-300 p-2" />
              }
              <div className="absolute bottom-0 inset-x-0 bg-blue-600 bg-opacity-80 flex items-center justify-center py-1">
                <CameraIcon className="h-3.5 w-3.5 text-white" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto}
              title="Subir foto de perfil" aria-label="Subir foto de perfil" />
            <p className="text-xs text-gray-500">Foto de perfil (opcional)</p>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Fecha de Nacimiento */}
          <div>
            <label htmlFor="ss-fecha" className="block text-sm font-medium text-gray-700 mb-1">Fecha de Nacimiento</label>
            <input id="ss-fecha" type="date" value={fechaNacimiento}
              onChange={e => setFechaNacimiento(e.target.value)}
              title="Fecha de nacimiento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Domicilio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Domicilio</label>
            <input type="text" value={domicilio} onChange={e => setDomicilio(e.target.value)}
              placeholder="Calle, número, barrio"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Ciudad */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ciudad</label>
            <input type="text" value={ciudad} onChange={e => setCiudad(e.target.value)}
              placeholder="Tu ciudad"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Contraseña */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nueva contraseña <span className="text-xs text-gray-400">(opcional — déjala vacía para no cambiarla)</span>
            </label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Nueva contraseña"
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Confirmar contraseña — siempre visible */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
            <div className="relative">
              <input type={showPass2 ? 'text' : 'password'} value={password2}
                onChange={e => setPassword2(e.target.value)}
                placeholder="Repite la contraseña"
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="button" onClick={() => setShowPass2(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass2 ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleCancel} disabled={saving}
              className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {saving ? 'Guardando...' : 'Guardar y Continuar'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
