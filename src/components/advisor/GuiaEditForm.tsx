'use client'

import { useState, useEffect, useRef } from 'react'
import { normalizeNumeroId } from '@/lib/numeroid-normalize'
import { normalizeTelefono } from '@/lib/telefono-normalize'
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

// Indicativo telefónico por país (se muestra junto al número; el número se captura SIN él).
const INDICATIVO: Record<string, string> = {
  Colombia: '+57', Mexico: '+52', Argentina: '+54', Chile: '+56', Peru: '+51', Ecuador: '+593',
  Venezuela: '+58', Bolivia: '+591', Paraguay: '+595', Uruguay: '+598', 'Costa Rica': '+506',
  Panama: '+507', Guatemala: '+502', Honduras: '+504', 'El Salvador': '+503', Nicaragua: '+505',
  'Republica Dominicana': '+1', Cuba: '+53', 'Puerto Rico': '+1', Espana: '+34', 'Estados Unidos': '+1', Brasil: '+55', Otro: '',
}

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
  const canActivar = hasPermission(AcademicoPermission.GUIA_ACTIVAR)
  // Estado del guía y lo que tiene a su nombre (lo muestra el aviso de desactivar).
  const [estado, setEstado] = useState<{ activo: boolean; cursosVigentes: number; clasesFuturas: number } | null>(null)
  const [confirmEstado, setConfirmEstado] = useState(false)
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
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
  const [showConfirm, setShowConfirm] = useState(false)

  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/postgres/guias/${advisorId}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (!d.success || !d.guia) { setMsg({ type: 'err', text: d.error || 'No se pudo cargar el guía' }); setLoading(false); return }
        const g = d.guia
        setForm({
          primerNombre: g.primerNombre || '', primerApellido: g.primerApellido || '',
          numeroId: g.numeroId || '', domicilio: g.domicilio || '', email: g.email || '',
          clave: g.clave || '', telefono: g.telefono || '', pais: g.pais || '', zoom: g.zoom || '',
          fechaNacimiento: g.fechaNacimiento ? String(g.fechaNacimiento).slice(0, 10) : '',
          fotoAdvisor: g.fotoAdvisor || null,
        })
        setEstado({ activo: !!g.activo, cursosVigentes: g.cursosVigentes || 0, clasesFuturas: g.clasesFuturas || 0 })
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
      const pr = await fetch('/api/postgres/guias/photo-presign-public', {
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
    if (!validate()) { setShowConfirm(false); return }
    setShowConfirm(false)
    setSaving(true); setMsg(null)
    try {
      let fotoKey: string | null = null
      if (fotoFile) {
        const k = await uploadFoto()
        if (!k) { setSaving(false); return }
        fotoKey = k
      }
      const res = await fetch(`/api/postgres/guias/${advisorId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, clave: form.clave.trim() || undefined, fotoKey: fotoKey || undefined }),
      })
      const d = await res.json()
      if (!res.ok || !d.success) throw new Error(d.error || 'Error al guardar')
      // Cerrar y volver a la lista de Guías.
      router.push('/dashboard/academic/advisors')
      router.refresh()
    } catch (err: any) {
      setMsg({ type: 'err', text: err.message })
      setSaving(false)
    }
  }

  const cambiarEstado = async () => {
    if (!estado) return
    setCambiandoEstado(true)
    try {
      const r = await fetch(`/api/postgres/guias/${advisorId}/estado`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !estado.activo }),
      })
      const d = await r.json()
      if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo cambiar el estado')
      setEstado(e => (e ? { ...e, activo: d.activo } : e))
      const acceso = d.acceso === 'cambiado'
        ? (d.activo ? ' Su acceso a la plataforma quedó habilitado.' : ' Su acceso a la plataforma quedó bloqueado.')
        : d.acceso === 'otro_rol' ? ' Su cuenta no es de rol Guía: su acceso no se tocó.' : ''
      setMsg({ type: 'ok', text: `Guía ${d.activo ? 'activado' : 'desactivado'}.${acceso}` })
      setConfirmEstado(false)
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || 'Error al cambiar el estado' })
    } finally {
      setCambiandoEstado(false)
    }
  }

  if (loading) return <div className="card"><div className="animate-pulse h-40 bg-gray-100 rounded" /></div>

  const inputCls = (err?: string) => `w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${err ? 'border-red-400' : 'border-gray-300'}`

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-primary-600 px-6 py-4 text-white flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{canEdit ? 'Editar Guía' : 'Información del Guía'}</h2>
            <p className="text-primary-200 text-sm flex items-center gap-2">
              {form.primerNombre} {form.primerApellido}
              {estado && (
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${estado.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {estado.activo ? 'Activo' : 'Inactivo'}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canActivar && estado && (
              <button type="button" onClick={() => setConfirmEstado(true)} disabled={cambiandoEstado}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${estado.activo ? 'bg-white/15 text-white hover:bg-white/25 border border-white/40' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
                {estado.activo ? 'Desactivar guía' : 'Activar guía'}
              </button>
            )}
            <button type="button" onClick={() => router.push('/dashboard/academic/advisors')}
              className="text-primary-100 hover:text-white text-sm">← Volver</button>
          </div>
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
            {/* País — reubicado a la izquierda de Teléfono (antes iba más abajo) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">País</label>
              <select value={form.pais} onChange={e => set('pais', e.target.value)} title="País del guía" className={inputCls()}>
                <option value="">Seleccionar país</option>
                {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {/* Teléfono: el indicativo (según país) va delante; el número se captura SIN indicativo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 text-sm text-gray-600 whitespace-nowrap min-w-[3.5rem] justify-center">
                  {INDICATIVO[form.pais] || '—'}
                </span>
                <input type="tel" value={form.telefono} onChange={e => set('telefono', normalizeTelefono(e.target.value))}
                  placeholder="Número sin indicativo" className={inputCls() + ' rounded-l-none'} />
              </div>
            </div>
            <Field label="Email *" value={form.email} onChange={v => set('email', v)} error={errors.email} type="email" cls={inputCls} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña <span className="text-gray-400 font-normal">(👁 para ver · edítala para cambiarla)</span></label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={form.clave} onChange={e => set('clave', e.target.value)}
                  placeholder="••••••" className={inputCls(errors.clave) + ' pr-10'} />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
              {errors.clave && <p className="text-red-500 text-xs mt-1">{errors.clave}</p>}
            </div>
            {/* Número de Identificación — reubicado (antes iba junto al teléfono) */}
            <Field label="Número de Identificación" value={form.numeroId} onChange={v => set('numeroId', normalizeNumeroId(v))} cls={inputCls} />
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
              <button type="button" onClick={() => { if (validate()) setShowConfirm(true) }} disabled={saving || uploading}
                className="px-6 py-2.5 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 disabled:opacity-50">
                {saving || uploading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmación de activar / desactivar */}
      {confirmEstado && estado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-3">
            <h3 className="text-lg font-bold text-gray-900">
              {estado.activo ? 'Desactivar' : 'Activar'} a {form.primerNombre} {form.primerApellido}
            </h3>
            {estado.activo ? (
              <>
                <p className="text-sm text-gray-600">
                  Dejará de aparecer en las listas y selectores de guías, y se le bloqueará el acceso a la plataforma
                  (si su cuenta es de rol Guía).
                </p>
                {(estado.cursosVigentes > 0 || estado.clasesFuturas > 0) && (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    Tiene <strong>{estado.cursosVigentes} curso(s) vigente(s)</strong> y <strong>{estado.clasesFuturas} clase(s) futura(s)</strong> a
                    su nombre. <strong>No se reasignan solos</strong>: hay que asignarles otro guía en Campañas.
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">Volverá a las listas de guías y se le habilitará el acceso a la plataforma.</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setConfirmEstado(false)} disabled={cambiandoEstado}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={cambiarEstado} disabled={cambiandoEstado}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${estado.activo ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {cambiandoEstado ? 'Guardando…' : estado.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de cambios */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900">Confirmar cambios</h3>
            <p className="mt-2 text-sm text-gray-600">
              ¿Guardar los cambios de <span className="font-medium">{form.primerNombre} {form.primerApellido}</span>?
              {form.clave.trim() && <span className="block mt-1 text-amber-700">Se actualizará la contraseña del guía.</span>}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} disabled={saving || uploading}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={saving || uploading}
                className="px-6 py-2.5 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 disabled:opacity-50">
                {saving || uploading ? 'Guardando...' : 'Confirmar y guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
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
