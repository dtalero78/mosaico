'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { UserCircleIcon, CameraIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const ALPHANUMERIC = /^[a-zA-Z0-9]+$/

export default function ActualizarDatosPage() {
  const router = useRouter()

  const [email,     setEmail]     = useState('')
  const [numberId,  setNumberId]  = useState('')
  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [celular,   setCelular]   = useState('')
  const [domicilio, setDomicilio] = useState('')
  const [fotoFile,  setFotoFile]  = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [saving,    setSaving]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Solo se permiten imágenes (JPG, PNG, WEBP, HEIC)'); return }
    setFotoFile(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  const validate = (): string | null => {
    if (!email.trim())    return 'El email es requerido'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Formato de email inválido'
    if (!numberId.trim()) return 'El número de identificación es requerido'
    if (!ALPHANUMERIC.test(numberId.trim())) return 'El número de ID solo permite letras y números (sin espacios, puntos ni guiones)'
    if (!password.trim()) return 'La clave es requerida'
    if (password.length < 6 || password.length > 10) return 'La clave debe tener entre 6 y 10 caracteres'
    if (/\s/.test(password)) return 'La clave no puede contener espacios'
    if (password !== password2) return 'Las claves no coinciden'
    if (!celular.trim())   return 'El celular es requerido'
    if (!domicilio.trim()) return 'El domicilio es requerido'
    if (!fotoFile)         return 'La foto es requerida'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate()
    if (err) { toast.error(err); return }

    setSaving(true)
    try {
      // 1. Get presigned URL for photo
      const presignRes = await fetch('/api/postgres/advisors/photo-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advisorId: Date.now().toString(), contentType: fotoFile!.type }),
      })
      const presignData = await presignRes.json()
      if (!presignData.success) throw new Error(presignData.error || 'Error al generar URL de foto')

      // 2. Upload photo directly to DO Spaces
      const uploadRes = await fetch(presignData.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fotoFile!.type },
        body: fotoFile,
      })
      if (!uploadRes.ok) throw new Error('Error al subir la foto')

      // 3. Save all profile data
      const saveRes = await fetch('/api/postgres/advisors/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:     email.trim().toLowerCase(),
          numberId:  numberId.trim().toUpperCase(),
          password,
          celular:   celular.trim(),
          domicilio: domicilio.trim(),
          fotoKey:   presignData.key,
        }),
      })
      const saveData = await saveRes.json()
      if (!saveData.success) throw new Error(saveData.error || 'Error al guardar')

      toast.success('¡Perfil actualizado exitosamente! Redirigiendo...')
      // Redirect to personal advisor panel using the new email
      const newEmail = email.trim().toLowerCase()
      setTimeout(() => router.push(`/panel-advisor?email=${encodeURIComponent(newEmail)}`), 1500)
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar el perfil')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="bg-blue-600 px-6 py-5">
          <h1 className="text-xl font-bold text-white">Actualización de Datos</h1>
          <p className="text-blue-100 text-sm mt-1">
            Complete su perfil para continuar. Este proceso se realiza una sola vez.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">

          {/* Foto */}
          <div className="flex flex-col items-center gap-2 mb-2">
            <div
              className="relative w-24 h-24 rounded-full overflow-hidden bg-gray-100 border-2 border-blue-200 cursor-pointer hover:opacity-90 transition"
              onClick={() => fileRef.current?.click()}
            >
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto" className="w-full h-full object-cover" />
                : <UserCircleIcon className="w-full h-full text-gray-300 p-2" />
              }
              <div className="absolute bottom-0 inset-x-0 bg-blue-600 bg-opacity-80 flex items-center justify-center py-1">
                <CameraIcon className="h-4 w-4 text-white" />
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
            <p className="text-xs text-gray-500">Haga clic para subir su foto *</p>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="su@email.com" />
          </div>

          {/* Número de identificación */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Número de Identificación * <span className="text-xs text-gray-400">(solo letras y números)</span>
            </label>
            <input type="text" value={numberId}
              onKeyDown={e => {
                if (!/^[a-zA-Z0-9]$/.test(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
                  e.preventDefault()
                }
              }}
              onChange={e => setNumberId(e.target.value.replace(/[^A-Z0-9]/g, '').toUpperCase())}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="12345678K" />
          </div>

          {/* Celular */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Celular *</label>
            <input type="text" value={celular} onChange={e => setCelular(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="+56 9 1234 5678" />
          </div>

          {/* Domicilio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Domicilio *</label>
            <input type="text" value={domicilio} onChange={e => setDomicilio(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Calle 123, Ciudad" />
          </div>

          {/* Clave */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Clave * <span className="text-xs text-gray-400">(letras, números y caracteres especiales, 6–10)</span>
            </label>
            <input type="password" value={password}
              onChange={e => { if (e.target.value.length <= 10) setPassword(e.target.value) }}
              maxLength={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Mínimo 6 caracteres" />
          </div>

          {/* Confirmar clave */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar Clave *</label>
            <input type="password" value={password2}
              onChange={e => { if (e.target.value.length <= 10) setPassword2(e.target.value) }}
              maxLength={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Repita la clave" />
          </div>

          <button type="submit" disabled={saving}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors mt-2">
            {saving ? 'Guardando...' : 'Guardar y Continuar'}
          </button>

        </form>
      </div>
    </div>
  )
}
