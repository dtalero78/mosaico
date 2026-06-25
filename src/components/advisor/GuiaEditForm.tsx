'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CameraIcon, UserCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { usePermissions } from '@/hooks/usePermissions'
import { AcademicoPermission } from '@/types/permissions'

const PAISES = [
  'Colombia', 'Mexico', 'Argentina', 'Chile', 'Peru', 'Ecuador', 'Venezuela',
  'Bolivia', 'Paraguay', 'Uruguay', 'Costa Rica', 'Panama', 'Guatemala',
  'Honduras', 'El Salvador', 'Nicaragua', 'Republica Dominicana', 'Cuba',
  'Puerto Rico', 'Espana', 'Estados Unidos', 'Brasil', 'Otro'
]

interface Form {
  primerNombre: string; primerApellido: string; numeroId: string; domicilio: string;
  email: string; clave: string; telefono: string; pais: string; zoom: string; fechaNacimiento: string;
  fotoAdvisor: string | null;
}
type Errors = Partial<Record<keyof Form | 'foto', string>>

export default function GuiaEditForm({ advisorId }: { advisorId: string }) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission(AcademicoPermission.GUIA_EDITAR) // SUPER_ADMIN/ADMIN bypassean
  const [form, setForm] = useState<Form>({
    primerNombre: '', primerApellido: '', numeroId: '', domicilio: '',
    email: '', clave: '', telefono: '', pais: '', zoom: '', fechaNacimiento: '', fotoAdvisor: null,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [showPass, setShowPass] = useState(false)

  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/postgres/advisors/${advisorId}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (!d.success || !d.guia) { setMsg({ type: 'err', text: d.error || 'No se pudo cargar el guía' }); setLoading(false); return }
        const g = d.guia
        setForm({
          primerNombre: g.primerNombre || '', primerApellido: g.primerApellido || '',
          numeroId: g.numeroId || '', domicilio: g.domicilio || '', email: g.email || '',
          clave: '', telefono: g.telefono || '', pais: g.pais || '', zoom: g.zoom || '',
          fechaNacimiento: g.fechaNacimiento ? String(g.fechaNacimiento).slice(0, 10) : '',
          fotoAdvisor: g.fotoAdvisor || null,
        })
        setLoading(false)
        // Cargar la foto actual (presigned)
        if (g.fotoAdvisor) {
          fetch(`/api/postgres/materials/presigned?key=${encodeURIComponent(g.fotoAdvisor)}`)
            .then(r => r.json()).then(p => { if (alive && p.signedUrl) setFotoPreview(p.signedUrl) }).catch(() => {})
        }
      })
      .catch(() => { if (alive) { setMsg({ type: 'err', text: 'Error al cargar' }); setLoading(false) } })
    return () => { alive = false }
  }, [advisorId])

  const set = (k: keyof Form, v: string) => {
    setForm(p => ({ ...p, [k]: v }))
    if ((errors as any)[k]) setErrors(p => { const c = { ...p }; delete (c as any)[k]; return c })
  }

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setErrors(p => ({ ...p, foto: 'Solo imágenes' })); return }
    setFotoFile(file)
    setFotoPreview(URL.createObjectURL(file))
    setErrors(p => { const c = { ...p }; delete c.foto; return c })
  }

  const uploadFoto = async (): Promise<string | null> => {
    if (!fotoFile) return null
    setUploading(true)
    try {
      const ext = fotoFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      const tempKey = `fotoGuia/edit_${advisorId}_${Date.now()}.${ext}`
      const pr = await fetch('/api/postgres/advisors/photo-presign-public', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempKey, contentType: fotoFile.type }),
      }).then(r => r.json())
      if (!pr.success) throw new Error(pr.error || 'Error al generar URL')
      const up = await fetch(pr.presignedUrl, { method: 'PUT', headers: { 'Content-Type': fotoFile.type }, body: fotoFile })
      if (!up.ok) throw new Error('Error al subir foto')
      return pr.key
    } catch (err: any) {
      setErrors(p => ({ ...p, foto: err.message || 'Error al subir foto' }))
      return null
    } finally { setUploading(false) }
  }

  const validate = (): boolean => {
    const e: Errors = {}
    if (!form.primerNombre.trim()) e.primerNombre = 'Requerido'
    if (!form.primerApellido.trim()) e.primerApellido = 'Requerido'
    if (!form.email.trim()) e.email = 'Requerido'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email no válido'
    if (form.clave.trim() && form.clave.trim().length < 4) e.clave = 'Mínimo 4 caracteres'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true); setMsg(null)
    try {
      let fotoKey: string | null = null
      if (fotoFile) {
        const k = await uploadFoto()
        if (!k) { setSaving(false); return }
        fotoKey = k
      }
      const res = await fetch(`/api/postgres/advisors/${advisorId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, clave: form.clave.trim() || undefined, fotoKey: fotoKey || undefined }),
      })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'Error al guardar')
      setMsg({ type: 'ok', text: 'Cambios guardados.' })
      setFotoFile(null)
    } catch (err: any) {
      setMsg({ type: 'err', text: err.message })
    } finally { setSaving(false) }
  }

  if (loading) return <div className="card"><div className="animate-pulse h-40 bg-gray-100 rounded" /></div>

  const inputCls = (err?: string) => `w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${err ? 'border-red-400' : 'border-gray-300'}`

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-primary-600 px-6 py-4 text-white flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{canEdit ? 'Editar Guía' : 'Información del Guía'}</h2>
            <p className="text-primary-200 text-sm">{form.primerNombre} {form.primerApellido}</p>
          </div>
          <button type="button" onClick={() => router.push('/dashboard/academic/advisors')}
            className="text-primary-100 hover:text-white text-sm">← Volver</button>
        </div>

        <div className="p-6 space-y-4">
          {msg && (
            <div className={`p-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{msg.text}</div>
          )}

          {!canEdit && (
            <div className="p-2.5 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-600">
              Solo lectura — no tienes permiso para editar este guía.
            </div>
          )}

          <fieldset disabled={!canEdit} className="space-y-4 border-0 p-0 m-0 min-w-0">
          {/* Foto */}
          <div className="flex items-center gap-4">
            <div className={`w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 flex-shrink-0 ${canEdit ? 'cursor-pointer hover:opacity-90' : ''} ${errors.foto ? 'border-red-400' : 'border-primary-200'}`}
              onClick={() => canEdit && fileRef.current?.click()}>
              {fotoPreview
                ? <img src={fotoPreview} alt="Foto" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex flex-col items-center justify-center text-gray-400"><UserCircleIcon className="h-10 w-10" /><CameraIcon className="h-4 w-4 -mt-1" /></div>}
            </div>
            <div>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 text-sm border border-primary-300 text-primary-600 rounded-lg hover:bg-primary-50">
                {fotoPreview ? 'Cambiar foto' : 'Subir foto'}
              </button>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, WEBP</p>
              {errors.foto && <p className="text-red-500 text-xs mt-1">{errors.foto}</p>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombres *" value={form.primerNombre} onChange={v => set('primerNombre', v)} error={errors.primerNombre} cls={inputCls} />
            <Field label="Apellidos *" value={form.primerApellido} onChange={v => set('primerApellido', v)} error={errors.primerApellido} cls={inputCls} />
            <Field label="Número de Identificación" value={form.numeroId} onChange={v => set('numeroId', v.replace(/[^A-Z0-9]/gi, '').toUpperCase())} cls={inputCls} />
            <Field label="Teléfono" value={form.telefono} onChange={v => set('telefono', v.replace(/[^\d]/g, ''))} cls={inputCls} />
            <Field label="Email *" value={form.email} onChange={v => set('email', v)} error={errors.email} type="email" cls={inputCls} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña <span className="text-gray-400 font-normal">(dejar vacío para no cambiar)</span></label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={form.clave} onChange={e => set('clave', e.target.value)}
                  placeholder="••••••" className={inputCls(errors.clave) + ' pr-10'} />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
              {errors.clave && <p className="text-red-500 text-xs mt-1">{errors.clave}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">País</label>
              <select value={form.pais} onChange={e => set('pais', e.target.value)} title="País del guía" className={inputCls()}>
                <option value="">Seleccionar país</option>
                {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <Field label="Fecha de Nacimiento" value={form.fechaNacimiento} onChange={v => set('fechaNacimiento', v)} type="date" cls={inputCls} />
            <div className="col-span-2">
              <Field label="Domicilio" value={form.domicilio} onChange={v => set('domicilio', v)} cls={inputCls} />
            </div>
            <div className="col-span-2">
              <Field label="Link de Zoom" value={form.zoom} onChange={v => set('zoom', v)} placeholder="https://zoom.us/j/..." cls={inputCls} />
            </div>
          </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => router.push('/dashboard/academic/advisors')}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">{canEdit ? 'Cancelar' : 'Volver'}</button>
            {canEdit && (
              <button type="button" onClick={handleSave} disabled={saving || uploading}
                className="px-6 py-2.5 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 disabled:opacity-50">
                {saving || uploading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, error, type = 'text', placeholder, cls }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; placeholder?: string;
  cls: (err?: string) => string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls(error)} />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  )
}
