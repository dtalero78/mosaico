'use client'

import { useEffect, useState } from 'react'
import DashboardLayout from '@/components/layout/DashboardLayout'
import { PermissionGuard } from '@/components/permissions/PermissionGuard'
import { MantenimientoPermission } from '@/types/permissions'
import { ArrowLeftIcon, CheckCircleIcon, ClipboardIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

const PLATAFORMAS = ['Chile', 'Colombia', 'Ecuador', 'Perú']
interface Rol { rol: string; descripcion: string | null }

export default function CrearAdministrativoPage() {
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [email, setEmail] = useState('')
  const [celular, setCelular] = useState('')
  const [plataforma, setPlataforma] = useState('')
  const [rol, setRol] = useState('')
  const [roles, setRoles] = useState<Rol[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ nombre: string; email: string; rol: string; clave: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/roles-administrativos', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRoles(d.roles || []))
      .catch(() => toast.error('Error al cargar roles'))
  }, [])

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = nombre.trim() && emailOk && rol && !busy

  const submit = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/usuarios-administrativos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), apellido: apellido.trim(), email: email.trim(), celular: celular.trim(), plataforma, rol }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || j?.message || 'Error al crear')
      setResult({ nombre: nombre.trim(), email: email.trim(), rol, clave: j.clave })
      toast.success('Usuario administrativo creado')
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  const reset = () => { setResult(null); setNombre(''); setApellido(''); setEmail(''); setCelular(''); setPlataforma(''); setRol('') }

  return (
    <DashboardLayout>
      <PermissionGuard permission={MantenimientoPermission.CREAR_ROL} showDefaultMessage>
        <div className="p-6 max-w-lg mx-auto">
          <button type="button" onClick={() => history.back()}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeftIcon className="w-4 h-4" /> Volver
          </button>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Crear Administrativo</h1>
          <p className="text-gray-500 mb-6">Cuenta de staff en USUARIOS_ROLES. Login por correo, clave automática.</p>

          {result ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
              <CheckCircleIcon className="w-10 h-10 text-emerald-600 mb-3" />
              <h2 className="text-lg font-semibold text-emerald-800">Usuario creado</h2>
              <p className="text-sm text-emerald-700 mt-1">{result.nombre} · {result.email} · <b>{result.rol}</b></p>
              <div className="mt-4 p-3 bg-white rounded-lg border border-emerald-200">
                <div className="text-xs text-gray-500 mb-1">Clave generada (compártela, no se vuelve a mostrar)</div>
                <div className="flex items-center gap-2">
                  <code className="text-lg font-mono font-bold text-gray-900">{result.clave}</code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(result.clave); toast.success('Clave copiada') }}
                    className="p-1.5 text-gray-400 hover:text-gray-600" title="Copiar">
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button type="button" onClick={reset}
                className="mt-5 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Crear otro</button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
                  <input value={nombre} onChange={e => setNombre(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Apellido</label>
                  <input value={apellido} onChange={e => setApellido(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Correo * (será su usuario de login)</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${email && !emailOk ? 'border-red-400' : 'border-gray-300'}`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Celular</label>
                  <input value={celular} onChange={e => setCelular(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Plataforma</label>
                  <select value={plataforma} onChange={e => setPlataforma(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">— (opcional) —</option>
                    {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rol *</label>
                <select value={rol} onChange={e => setRol(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">— Selecciona el rol —</option>
                  {roles.map(r => <option key={r.rol} value={r.rol}>{r.rol}{r.descripcion ? ` — ${r.descripcion}` : ''}</option>)}
                </select>
              </div>
              <button type="button" onClick={submit} disabled={!canSubmit}
                className="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? 'Creando…' : 'Crear Administrativo'}
              </button>
            </div>
          )}
        </div>
      </PermissionGuard>
    </DashboardLayout>
  )
}
