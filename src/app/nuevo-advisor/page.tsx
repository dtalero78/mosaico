'use client'

import { useState, useRef } from 'react'
import { CameraIcon, UserCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'

const PAISES = [
  'Colombia', 'Mexico', 'Argentina', 'Chile', 'Peru', 'Ecuador', 'Venezuela',
  'Bolivia', 'Paraguay', 'Uruguay', 'Costa Rica', 'Panama', 'Guatemala',
  'Honduras', 'El Salvador', 'Nicaragua', 'Republica Dominicana', 'Cuba',
  'Puerto Rico', 'Espana', 'Estados Unidos', 'Brasil', 'Otro'
]

interface FormData {
  primerNombre: string
  primerApellido: string
  numeroId: string
  domicilio: string
  email: string
  clave: string
  telefono: string
  pais: string
  zoom: string
  fechaNacimiento: string
  fotoKey: string   // DO Spaces key after upload
}

type FormErrors = Partial<Record<keyof FormData | 'foto', string>>

export default function NuevoAdvisorPage() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>({
    primerNombre: '', primerApellido: '', numeroId: '', domicilio: '',
    email: '', clave: '', telefono: '', pais: '', zoom: '', fechaNacimiento: '', fotoKey: '',
  })
  const [errors,     setErrors]     = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [apiError,   setApiError]   = useState<string | null>(null)

  const [showPass, setShowPass] = useState(false)

  // Photo states
  const [fotoFile,    setFotoFile]    = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const [uploading,   setUploading]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    if ((errors as any)[field]) setErrors(prev => { const c = { ...prev }; delete (c as any)[field]; return c })
  }

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setErrors(prev => ({ ...prev, foto: 'Solo imágenes (JPG, PNG, WEBP)' })); return }
    setFotoFile(file)
    setFotoPreview(URL.createObjectURL(file))
    setErrors(prev => { const c = { ...prev }; delete c.foto; return c })
  }

  // Upload photo to DO Spaces via presigned URL (temp key using timestamp — advisor ID not known yet)
  const uploadFoto = async (): Promise<string | null> => {
    if (!fotoFile) return null
    setUploading(true)
    try {
      const ext = fotoFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      const tempKey = `fotosAdvisors/new_${Date.now()}.${ext}`
      // Get presigned PUT URL directly from spaces config
      const presignRes = await fetch('/api/postgres/advisors/photo-presign-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempKey, contentType: fotoFile.type }),
      })
      const presignData = await presignRes.json()
      if (!presignData.success) throw new Error(presignData.error || 'Error al generar URL')

      const uploadRes = await fetch(presignData.presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': fotoFile.type },
        body: fotoFile,
      })
      if (!uploadRes.ok) throw new Error('Error al subir foto')
      return presignData.key
    } catch (err: any) {
      setErrors(prev => ({ ...prev, foto: err.message || 'Error al subir foto' }))
      return null
    } finally {
      setUploading(false)
    }
  }

  const validateStep = (currentStep: number): boolean => {
    const e: FormErrors = {}
    if (currentStep === 1) {
      if (!form.primerNombre.trim())  e.primerNombre  = 'Requerido'
      if (!form.primerApellido.trim()) e.primerApellido = 'Requerido'
      if (!form.numeroId.trim())       e.numeroId       = 'Requerido'
      if (!form.domicilio.trim())      e.domicilio      = 'Requerido'
    }
    if (currentStep === 2) {
      if (!form.email.trim())    e.email = 'Requerido'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email no válido'
      if (!form.clave.trim())    e.clave = 'Requerido'
      else if (form.clave.trim().length < 4) e.clave = 'Mínimo 4 caracteres'
      if (!form.telefono.trim()) e.telefono = 'Requerido'
      if (!form.pais)            e.pais = 'Requerido'
    }
    if (currentStep === 3) {
      if (!form.fechaNacimiento) e.fechaNacimiento = 'Requerido'
      if (!form.zoom.trim())     e.zoom = 'Requerido'
      // Foto obligatoria — debe haber un fotoKey (ya subida) o un fotoFile pendiente
      if (!form.fotoKey && !fotoFile) e.fotoKey = 'La foto de perfil es obligatoria'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => {
    if (validateStep(step)) { setStep(p => p + 1); window.scrollTo(0, 0) }
  }
  const handleBack = () => { setStep(p => p - 1); window.scrollTo(0, 0) }

  const handleSubmit = async () => {
    if (!validateStep(3)) return
    setSubmitting(true)
    setApiError(null)
    try {
      // Upload photo first if provided
      let fotoKey = form.fotoKey
      if (fotoFile && !fotoKey) {
        const key = await uploadFoto()
        if (!key) { setSubmitting(false); return }
        fotoKey = key
      }

      const res = await fetch('/api/postgres/advisors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, fotoKey }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al crear el registro')
      setDone(true)
    } catch (err: any) {
      setApiError(err.message || 'Error desconocido')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Registro Creado</h2>
          <p className="text-gray-600 mb-1">Tu cuenta de advisor ha sido creada exitosamente.</p>
          <p className="text-sm text-gray-500">Puedes cerrar esta pagina.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-5 text-white">
          <h1 className="text-xl font-bold">Registro de Advisor</h1>
          <p className="text-indigo-200 text-sm mt-1">Let&apos;s Go Speak</p>
        </div>

        {/* Progress */}
        <div className="px-6 pt-5">
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex-1 flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                  ${s < step ? 'bg-green-500 text-white' : s === step ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {s < step
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    : s}
                </div>
                {s < 3 && <div className={`flex-1 h-1 rounded ${s < step ? 'bg-green-500' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mb-1">
            Paso {step} de 3 &mdash; {step === 1 ? 'Datos Básicos' : step === 2 ? 'Contacto' : 'Zoom y Foto'}
          </p>
        </div>

        {/* Form */}
        <div className="px-6 pb-6 pt-2">
          {apiError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{apiError}</div>
          )}

          {/* Step 1: Datos Básicos */}
          {step === 1 && (
            <div className="space-y-4">
              <Field label="Nombres" value={form.primerNombre}
                onChange={v => updateField('primerNombre', v)} error={errors.primerNombre}
                placeholder="Ej: Juan Carlos" required />
              <Field label="Apellidos" value={form.primerApellido}
                onChange={v => updateField('primerApellido', v)} error={errors.primerApellido}
                placeholder="Ej: Pérez García" required />
              <Field label="Número de Identificación" value={form.numeroId}
                onChange={v => updateField('numeroId', v.replace(/[^A-Z0-9]/g, '').toUpperCase())}
                error={errors.numeroId} placeholder="Ej: 12345678K"
                hint="Solo letras mayúsculas y números" required />
              <Field label="Domicilio" value={form.domicilio}
                onChange={v => updateField('domicilio', v)} error={errors.domicilio}
                placeholder="Calle 123, Ciudad" required />
            </div>
          )}

          {/* Step 2: Contacto */}
          {step === 2 && (
            <div className="space-y-4">
              <Field label="Email" value={form.email}
                onChange={v => updateField('email', v)} error={errors.email}
                placeholder="advisor@email.com" type="email" required />
              {/* Contraseña con toggle ver/ocultar */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contraseña <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.clave}
                    onChange={e => updateField('clave', e.target.value)}
                    placeholder="Mínimo 4 caracteres"
                    className={`w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.clave ? 'border-red-400' : 'border-gray-300'}`}
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>
                {errors.clave && <p className="text-red-500 text-xs mt-1">{errors.clave}</p>}
              </div>
              <Field label="Teléfono" value={form.telefono}
                onChange={v => updateField('telefono', v.replace(/[^\d]/g, ''))}
                error={errors.telefono} placeholder="Ej: 56912345678"
                hint="Solo números, sin + ni espacios" required />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  País <span className="text-red-500">*</span>
                </label>
                <select value={form.pais} onChange={e => updateField('pais', e.target.value)}
                  title="País del advisor"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.pais ? 'border-red-400' : 'border-gray-300'}`}>
                  <option value="">Seleccionar país</option>
                  {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {errors.pais && <p className="text-red-500 text-xs mt-1">{errors.pais}</p>}
              </div>
            </div>
          )}

          {/* Step 3: Foto + Zoom */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Foto */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Foto de perfil <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-4">
                  <div
                    className={`w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 cursor-pointer hover:opacity-90 transition flex-shrink-0 ${
                      errors.fotoKey ? 'border-red-400' : 'border-indigo-200'
                    }`}
                    onClick={() => fileRef.current?.click()}
                  >
                    {fotoPreview
                      ? <img src={fotoPreview} alt="Foto" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                          <UserCircleIcon className="h-10 w-10" />
                          <CameraIcon className="h-4 w-4 -mt-1" />
                        </div>
                    }
                  </div>
                  <div>
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="px-3 py-1.5 text-sm border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 transition">
                      {fotoPreview ? 'Cambiar foto' : 'Subir foto'}
                    </button>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP</p>
                    {errors.fotoKey && <p className="text-red-500 text-xs mt-1">{errors.fotoKey}</p>}
                    {errors.foto && <p className="text-red-500 text-xs mt-1">{errors.foto}</p>}
                  </div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
              </div>

              <div>
                <label htmlFor="na-fecha" className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de Nacimiento <span className="text-red-500">*</span>
                </label>
                <input id="na-fecha" type="date" value={form.fechaNacimiento}
                  onChange={e => updateField('fechaNacimiento', e.target.value)}
                  title="Fecha de nacimiento del advisor"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors.fechaNacimiento ? 'border-red-400' : 'border-gray-300'}`}
                />
                {errors.fechaNacimiento && <p className="text-red-500 text-xs mt-1">{errors.fechaNacimiento}</p>}
              </div>

              <Field label="Link de Zoom" value={form.zoom}
                onChange={v => updateField('zoom', v)} error={errors.zoom}
                placeholder="https://zoom.us/j/..." required />

              {/* Summary */}
              <div className="mt-2 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Resumen</h3>
                <div className="space-y-1 text-sm text-gray-600">
                  <p><span className="font-medium">Nombre:</span> {form.primerNombre} {form.primerApellido}</p>
                  <p><span className="font-medium">ID:</span> {form.numeroId}</p>
                  <p><span className="font-medium">Domicilio:</span> {form.domicilio}</p>
                  <p><span className="font-medium">Email:</span> {form.email}</p>
                  <p><span className="font-medium">Teléfono:</span> {form.telefono}</p>
                  <p><span className="font-medium">País:</span> {form.pais}</p>
                  <p><span className="font-medium">Fecha Nacimiento:</span> {form.fechaNacimiento || '—'}</p>
                  <p><span className="font-medium">Zoom:</span> {form.zoom}</p>
                  {fotoPreview && <p><span className="font-medium">Foto:</span> ✓ Cargada</p>}
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
            {step > 1
              ? <button type="button" onClick={handleBack} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Atrás</button>
              : <div />
            }
            {step < 3
              ? <button type="button" onClick={handleNext} className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Siguiente</button>
              : <button type="button" onClick={handleSubmit} disabled={submitting || uploading}
                  className="px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">
                  {submitting || uploading ? 'Procesando...' : 'Crear Registro'}
                </button>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, error, placeholder, type = 'text', required = false, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  error?: string; placeholder?: string; type?: string; required?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${error ? 'border-red-400' : 'border-gray-300'}`}
      />
      {hint && !error && <p className="text-gray-400 text-xs mt-1">{hint}</p>}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}
